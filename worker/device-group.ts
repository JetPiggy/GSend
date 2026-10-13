import { DurableObject } from "cloudflare:workers";
import {
  ERROR_TEXT,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  MAX_GROUP_DEVICES,
  MAX_SIGNAL_BYTES,
  isConnectionOutcome,
  isConnectionPath,
  isDeviceId,
  type GroupClientMessage,
  type GroupServerMessage,
  type IceServer,
  type ServerErrorCode,
} from "../shared/protocol";
import { STUN_ONLY, credentialsLifetimeMs, mintIceServers } from "./turn";

const ICE_KEY = "ice";

/** Sockets in this tag are one-shot error replies, not room members. */
const REJECT_TAG = "reject";

/** The close code for a member's older socket when the same device connects again. */
const REPLACED = 4002;
/** The close code for a member that stopped answering its heartbeat. */
const SILENT = 4004;

/**
 * How long a member may go without a heartbeat before it counts as gone. Clients ping
 * every 20 seconds, or about once a minute in a tab the browser is throttling; one
 * silent for longer went to sleep or lost its network without saying goodbye, and
 * listing it as present only sends calls to a device that cannot answer them.
 */
const SILENT_AFTER_MS = 120_000;

/**
 * A device reports one count per connection it makes, and no connection is made and
 * measured faster than this. Each report is a storage write, so a socket sending them
 * faster is not a client of ours and is not counted.
 */
const STAT_INTERVAL_MS = 5_000;

/** What this object remembers about a socket, carried across hibernation. */
interface Membership {
  /** Retired for silence: still closing as far as the runtime knows, but no longer a member. */
  gone?: true;
  statAt?: number;
}

/**
 * A meeting point for one person's paired devices.
 *
 * The room's name is an HMAC only those devices can compute, so arriving here is
 * already evidence of belonging — but the room deliberately does not act on that. It
 * keeps no membership, verifies no identity and stores nothing but a cached set of
 * relay credentials. Devices prove who they are to *each other* over the encrypted
 * data channel once it is up; this object only introduces them, exactly as
 * `SessionRoom` does for a 4-digit code.
 *
 * Because the name rotates every few hours, these objects are disposable: one goes
 * quiet when its window passes, and the alarm clears the only thing it ever wrote.
 */
export class DeviceGroup extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking this object. The timestamps it keeps are
    // also how this object tells a member that went silent from one that is quiet.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/join") return new Response("not found", { status: 404 });

    const device = url.searchParams.get("device") ?? "";
    if (!isDeviceId(device)) return this.rejectSocket("bad_request");

    // A device reconnecting supersedes its own stale socket rather than counting twice
    // against the room, which is what a phone waking up looks like from here.
    for (const stale of this.members(device)) {
      try {
        stale.close(REPLACED, "replaced");
      } catch {
        /* already gone */
      }
    }
    // Whoever arrives is about to be told who is here, and may call one of them at once.
    this.retireSilent(device);

    if (this.deviceIds().filter((id) => id !== device).length >= MAX_GROUP_DEVICES) {
      return this.rejectSocket("session_full");
    }

    const peers = this.deviceIds()
      .filter((id) => id !== device)
      .map((id) => ({ id }));

    const { server, response } = this.acceptSocket(device);
    send(server, { t: "group", self: device, peers });
    this.broadcast({ t: "joined", peer: { id: device } }, device);
    return response;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_SIGNAL_BYTES) return;

    const from = this.deviceOf(ws);
    if (!from) return;

    let msg: GroupClientMessage;
    try {
      msg = JSON.parse(raw) as GroupClientMessage;
    } catch {
      return;
    }

    if (msg.t === "to") {
      if (typeof msg.peer !== "string" || !isDeviceId(msg.peer) || msg.peer === from) return;
      // A call to a device that has gone silent would wait out the caller's timeout;
      // retiring it first tells the caller now, through the departure it announces.
      this.retireSilent(from);
      for (const target of this.members(msg.peer)) {
        send(target, { t: "from", peer: from, data: msg.data });
      }
      return;
    }

    if (msg.t === "ice") {
      send(ws, { t: "ice", iceServers: await this.iceServers() });
      return;
    }

    if (msg.t === "stat") {
      if (!isConnectionOutcome(msg.outcome) || !isConnectionPath(msg.path)) return;
      const membership = membershipOf(ws);
      const now = Date.now();
      if (membership.statAt !== undefined && now - membership.statAt < STAT_INTERVAL_MS) return;
      ws.serializeAttachment({ ...membership, statAt: now } satisfies Membership);

      const metrics = this.env.METRICS.get(this.env.METRICS.idFromName("global"));
      await metrics.record(msg.outcome, msg.path);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.announceDeparture(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.announceDeparture(ws);
  }

  private announceDeparture(ws: WebSocket): void {
    // A retired socket's departure was announced when it was retired.
    const device = this.deviceOf(ws);
    if (!device) return;

    // A reconnect closes the socket it replaces, and that close lands afterwards.
    // Reporting it would take the device off the other screens seconds after it
    // arrived, with nothing to correct the impression.
    if (this.members(device).some((other) => other !== ws)) return;
    this.broadcast({ t: "left", peer: device }, device);
  }

  /**
   * Retire the members whose heartbeat stopped. The runtime answers the pings without
   * waking this object, so nothing here runs on a timer; instead each arrival and each
   * call checks first, which is when a member that is not really there would mislead.
   * A socket that has never pinged belongs to an older client and is left alone.
   */
  private retireSilent(except: string): void {
    const now = Date.now();
    const departed = new Set<string>();

    for (const ws of this.members()) {
      const device = this.deviceOf(ws);
      if (!device || device === except) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      if (!lastPing || now - lastPing.getTime() < SILENT_AFTER_MS) continue;

      // Marked before closing: the closing handshake with a client that stopped
      // answering never completes, so the runtime may keep listing this socket.
      ws.serializeAttachment({ ...membershipOf(ws), gone: true } satisfies Membership);
      try {
        ws.close(SILENT, "stopped answering");
      } catch {
        /* already gone */
      }
      departed.add(device);
    }

    for (const device of departed) {
      if (this.members(device).length === 0) this.broadcast({ t: "left", peer: device }, device);
    }
  }

  /**
   * Relay credentials are billable, so one set is minted per room and shared, and the
   * alarm exists purely to take this object back down to nothing once they expire.
   */
  private async iceServers(): Promise<IceServer[]> {
    const now = Date.now();
    const cached = await this.ctx.storage.get<{ servers: IceServer[]; expiresAt: number }>(ICE_KEY);
    if (cached && cached.expiresAt > now) return cached.servers;

    const servers = await mintIceServers(this.env).catch(() => STUN_ONLY);
    const expiresAt = now + credentialsLifetimeMs();
    await this.ctx.storage.put(ICE_KEY, { servers, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt + 1_000);
    return servers;
  }

  async alarm(): Promise<void> {
    const cached = await this.ctx.storage.get<{ expiresAt: number }>(ICE_KEY);
    if (cached && cached.expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(cached.expiresAt + 1_000);
      return;
    }
    await this.ctx.storage.deleteAll();
  }

  /** The sockets that count as in the room, for one device or all of them. */
  private members(device?: string): WebSocket[] {
    return this.ctx.getWebSockets(device).filter((ws) => !membershipOf(ws).gone);
  }

  private deviceIds(): string[] {
    const ids = new Set<string>();
    for (const ws of this.members()) {
      const id = this.deviceOf(ws);
      if (id) ids.add(id);
    }
    return [...ids];
  }

  private deviceOf(ws: WebSocket): string | null {
    if (membershipOf(ws).gone) return null;
    const tag = this.ctx.getTags(ws)[0];
    return tag && tag !== REJECT_TAG && isDeviceId(tag) ? tag : null;
  }

  private broadcast(msg: GroupServerMessage, except: string): void {
    for (const ws of this.members()) {
      if (this.deviceOf(ws) === except) continue;
      send(ws, msg);
    }
  }

  private acceptSocket(tag: string): { server: WebSocket; response: Response } {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [tag]);
    return { server, response: new Response(null, { status: 101, webSocket: client }) };
  }

  /** Reply over a real socket so the browser can show why, not just "connection failed". */
  private rejectSocket(code: ServerErrorCode): Response {
    const { server, response } = this.acceptSocket(REJECT_TAG);
    send(server, { t: "error", code, message: ERROR_TEXT[code] });
    try {
      server.close(4000, code);
    } catch {
      /* already gone */
    }
    return response;
  }
}

function membershipOf(ws: WebSocket): Membership {
  const stored: unknown = ws.deserializeAttachment();
  return stored && typeof stored === "object" ? (stored as Membership) : {};
}

function send(ws: WebSocket, msg: GroupServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket already closing */
  }
}

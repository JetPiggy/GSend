/**
 * The socket that keeps this device findable by the ones it has been paired with.
 *
 * Unlike the code-based session, this connection is not tied to a transfer: it is open
 * whenever the page is, carrying nothing but presence and the signalling needed to
 * start a peer connection with one of the other devices. It reconnects on its own, and
 * it moves to a fresh room when the derived name's window rolls over.
 */
import type {
  ConnectionOutcome,
  ConnectionPath,
  GroupClientMessage,
  GroupServerMessage,
  IceServer,
} from "../../shared/protocol";
import { rendezvousName, windowEndsAt } from "./devices";
import { Heartbeat } from "./heartbeat";

export interface GroupHandlers {
  /** The full set of other devices currently in the room. */
  onPresence(peers: string[]): void;
  onSignal(peer: string, data: unknown): void;
  onIce(servers: IceServer[]): void;
  /**
   * Raised when the socket cannot be kept up, or another tab has taken this device's
   * place, so the interface can stop claiming to be online.
   */
  onOffline(): void;
}

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
/** Move to the next window slightly early, so both devices overlap rather than miss. */
const ROLLOVER_LEAD_MS = 5_000;
/** The close code the room uses on a device's older socket when the same device connects again. */
const REPLACED = 4002;

export class GroupLink {
  private socket: WebSocket | null = null;
  private secret: string | null = null;
  private device: string | null = null;
  private peers = new Set<string>();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private rolloverTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  /** Bumped by every connect, so one that finishes deriving its room late can tell it was overtaken. */
  private connectToken = 0;
  /** A moment inside the window whose room this device belongs in. */
  private roomAt = 0;
  /** Another tab or window of this browser holds this device's place in the room. */
  private displacedByOtherTab = false;
  private readonly heartbeat = new Heartbeat((socket) => this.dropDead(socket));

  constructor(private readonly handlers: GroupHandlers) {}

  get online(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get displaced(): boolean {
    return this.displacedByOtherTab;
  }

  get present(): string[] {
    return [...this.peers];
  }

  start(secret: string, device: string): void {
    // Already in that group. Moving the socket anyway would take this device off every
    // other screen for a moment, which is what each pairing used to do to a live session.
    if (!this.stopped && this.secret === secret && this.device === device) return;
    this.secret = secret;
    this.device = device;
    this.stopped = false;
    this.displacedByOtherTab = false;
    this.attempt = 0;
    this.roomAt = Date.now();
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connectToken += 1;
    this.clearTimers();
    this.peers.clear();
    this.release();
    this.handlers.onPresence([]);
  }

  /**
   * The page is in front again, or the network changed. A socket that is down
   * reconnects now instead of at the end of its backoff, and one that looks up is
   * probed. A tab that lost the room to another tab takes it back only when it is the
   * one being looked at (`inFront`), since that is the tab that should answer a call;
   * a network change reaches every tab at once and must not start a tug of war.
   */
  wake(inFront: boolean): void {
    if (this.stopped) return;
    const state = this.socket?.readyState;
    if (state === WebSocket.OPEN) {
      this.heartbeat.wake();
      return;
    }
    if (state === WebSocket.CONNECTING) return;
    if (this.displacedByOtherTab && !inFront) return;
    this.displacedByOtherTab = false;
    this.attempt = 0;
    void this.connect();
  }

  send(peer: string, data: unknown): void {
    this.sendRaw({ t: "to", peer, data });
  }

  requestIce(): void {
    this.sendRaw({ t: "ice" });
  }

  sendStat(outcome: ConnectionOutcome, path: ConnectionPath): void {
    this.sendRaw({ t: "stat", outcome, path });
  }

  private sendRaw(msg: GroupClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  private async connect(): Promise<void> {
    if (this.stopped || !this.secret || !this.device) return;
    this.clearTimers();
    // Never two sockets at once. The room keeps one per device, so a second would close
    // the first exactly the way another tab taking over does.
    this.release();
    const token = ++this.connectToken;

    // A reconnect inside the rollover lead must not fall back to the room just left.
    this.roomAt = Math.max(this.roomAt, Date.now());
    const at = this.roomAt;

    let room: string;
    try {
      room = await rendezvousName(this.secret, at);
    } catch {
      this.scheduleRetry();
      return;
    }
    if (this.stopped || token !== this.connectToken) return;

    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams({ role: "rendezvous", room, device: this.device });
    const socket = new WebSocket(`${scheme}//${location.host}/api/ws?${query.toString()}`);
    this.socket = socket;
    const roomEndsAt = windowEndsAt(at);

    // Each handler checks that its socket is still the current one: a socket that was
    // replaced still delivers its closing events, and acting on them would tear down the
    // socket that replaced it.
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.heartbeat.watch(socket);
      this.scheduleRollover(roomEndsAt);
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      if (this.heartbeat.handle(event.data)) return;
      if (typeof event.data !== "string") return;
      try {
        this.onMessage(JSON.parse(event.data) as GroupServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.heartbeat.stop();
      this.peers.clear();
      this.handlers.onPresence([]);
      if (event.code === REPLACED) {
        // This device connected again from another tab or window. Retrying would take
        // the room back, that tab would take it back in turn, and the two used to trade
        // it every second — splitting each call between them, so it never connected.
        // This one steps aside until it is brought to the front again.
        this.displacedByOtherTab = true;
        this.handlers.onOffline();
        return;
      }
      this.handlers.onOffline();
      this.scheduleRetry();
    });

    socket.addEventListener("error", () => {
      /* the close handler runs next and carries the outcome */
    });
  }

  private onMessage(msg: GroupServerMessage): void {
    switch (msg.t) {
      case "group":
        this.peers = new Set(msg.peers.map((peer) => peer.id));
        this.handlers.onPresence(this.present);
        break;
      case "joined":
        this.peers.add(msg.peer.id);
        this.handlers.onPresence(this.present);
        break;
      case "left":
        this.peers.delete(msg.peer);
        this.handlers.onPresence(this.present);
        break;
      case "from":
        this.handlers.onSignal(msg.peer, msg.data);
        break;
      case "ice":
        this.handlers.onIce(msg.iceServers);
        break;
      case "error":
        // Nothing here is recoverable by retrying immediately; back off like a drop.
        this.socket?.close();
        break;
    }
  }

  /** Let go of the current socket, if any, without its closure counting as a drop. */
  private release(): void {
    const socket = this.socket;
    this.socket = null;
    this.heartbeat.stop();
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "left the group");
  }

  /** The socket stopped answering. Its closing handshake would never complete, so it is not waited for. */
  private dropDead(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.release();
    this.peers.clear();
    this.handlers.onPresence([]);
    this.handlers.onOffline();
    this.attempt = 0;
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(MIN_RETRY_MS * 2 ** this.attempt, MAX_RETRY_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  /**
   * The room name is only valid for its window, so the socket has to move before the
   * window ends. Reconnecting a few seconds early means both devices are briefly
   * reaching for the same next room rather than passing each other between two.
   */
  private scheduleRollover(roomEndsAt: number): void {
    if (this.rolloverTimer) clearTimeout(this.rolloverTimer);
    const delay = Math.max(1_000, roomEndsAt - Date.now() - ROLLOVER_LEAD_MS);
    this.rolloverTimer = setTimeout(() => {
      this.rolloverTimer = null;
      // The next window's room has to be named for that window. Named for the current
      // moment it is still this one for the last few seconds, and the early move used
      // to reconnect to the same room once a second until the window actually turned.
      this.roomAt = roomEndsAt;
      void this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.rolloverTimer) clearTimeout(this.rolloverTimer);
    this.retryTimer = null;
    this.rolloverTimer = null;
  }
}

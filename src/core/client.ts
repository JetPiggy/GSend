import {
  RESUME_GRACE_MS,
  isValidCode,
  type ConnectionOutcome,
  type ConnectionPath,
  type IceServer,
  type Role,
  type ServerErrorCode,
  type ServerMessage,
} from "../../shared/protocol";
import type { Message, MessageKey } from "../i18n/strings";
import { PeerLink, STUN_ONLY, type PeerChannels, type PeerState } from "./peer";
import { saveFiles } from "./save";
import { clearSession, loadSession, saveSession } from "./session-store";
import {
  chooseSaveDirectory,
  forgetSaveDirectory,
  restoreSaveDirectory,
  saveDirectoryName,
} from "./sink";
import {
  forgetDevice,
  forgetGroup,
  groupSecret,
  knownDevices,
  renameKnownDevice,
  type KnownDevice,
} from "./devices";
import { GroupLink } from "./group";
import { Handshake, isHandshakeMessage, type PairOffer } from "./handshake";
import { loadIdentity, renameDevice, type Identity } from "./identity";
import type { PeerControl } from "./protocol";
import { Signaling } from "./signaling";
import { TransferEngine, type TextMessage, type TransferView } from "./transfer";

/** How this session found its peer: someone typed a code, or the devices already knew each other. */
export type Mode = "code" | "group";

/** A device this one has been paired with, and whether it is reachable right now. */
export interface DeviceView {
  id: string;
  /** The name this device gave it, or else its own. */
  name: string;
  /** What the device calls itself. */
  ownName: string;
  online: boolean;
}

export type Phase =
  | "idle"
  | "creating"
  | "hosting"
  | "joining"
  | "pairing"
  | "active"
  | "ended";

export interface Snapshot {
  phase: Phase;
  role: Role | null;
  code: string | null;
  joinExpiresAt: number | null;
  shareUrl: string | null;
  peerPresent: boolean;
  /** When the other device dropped off, so the UI can explain the wait. */
  peerAbsentSince: number | null;
  connection: PeerState;
  /** True once this session brought the relay into play (billable path). */
  relayEngaged: boolean;
  /**
   * The route the connection actually took, read from the transport once it is up.
   * Bringing the relay into play does not mean the bytes go through it, and the other
   * side's relay can carry them when this side never engaged one, so only this says why
   * a transfer is slow.
   */
  path: ConnectionPath | null;
  channelsOpen: boolean;
  mode: Mode;
  /** This device's own name and id, once the browser has given us a durable store. */
  identity: { id: string; name: string } | null;
  /** Paired devices, with live presence from the rendezvous room. */
  devices: DeviceView[];
  /** Whether this device is currently findable by the others. */
  groupOnline: boolean;
  /** Another tab or window of this browser is the one the other devices can reach. */
  groupDisplaced: boolean;
  /** The paired device this session is talking to, when it came from the device list. */
  peerDevice: string | null;
  /** Whether the peer has proved which device it is. Required before anything moves in group mode. */
  verified: boolean;
  /**
   * In a code session whose peer has proved which device it is: whether the two are
   * going to remember each other, and the name it gave. Null otherwise, a device
   * session included, since its two ends are paired already.
   */
  pairing: { offer: PairOffer; name: string } | null;
  /** The folder incoming files are being written into, when one was chosen. */
  savingTo: string | null;
  /** When the other device came through, so the sender can see it happen. */
  peerJoinedAt: number | null;
  outgoing: TransferView[];
  incoming: TransferView[];
  texts: TextMessage[];
  /** Staged before the code was created, waiting for a peer to connect. */
  pendingShare: { files: number; bytes: number; text: boolean } | null;
  /**
   * A session that ended before anything moved can be tried again with the same files:
   * a call to the same paired device, or (device null) a fresh code. Null otherwise.
   */
  retry: { device: string | null } | null;
  notice: Message | null;
  error: Message | null;
}

/**
 * Byte-level progress is coalesced to this. The receiving side handles every frame on
 * the main thread, so a re-render 25 times a second competed with the transfer itself
 * on a phone, and a ten-cell progress bar has nothing to show at that rate anyway.
 */
const PROGRESS_THROTTLE_MS = 150;
const MAX_RECONNECT_DELAY_MS = 15_000;
/** How often an unanswered call to a paired device is repeated, and how many times. */
const CALL_RETRY_MS = 2_000;
const CALL_ATTEMPTS = 6;
/**
 * How long a paired device may be missing from the rendezvous room before a session
 * that never got connected is given up. Long enough to forgive a socket reconnecting
 * or a window rolling over; short enough that nobody is left watching "Connecting".
 */
const GROUP_ABSENCE_MS = 20_000;
/** Control messages held back for an unproved peer; anything past this is not a real peer. */
const MAX_HELD_CONTROL = 512;
/** ICE restarts often recover, so a failure only counts once it stops recovering. */
const FAILURE_CONFIRM_MS = 15_000;
/** Never hold a connection back waiting for relay credentials that may not arrive. */
const ICE_REQUEST_TIMEOUT_MS = 3_000;
/**
 * ICE keeps checking after the channels open and can settle on a better pair than the
 * one that happened to validate first, so the path is read once it has stopped moving.
 * Reading it immediately reports a race, not a route.
 */
const PATH_SETTLE_MS = 5_000;
/**
 * How long a direct-only attempt gets before the relay is brought in. ICE priority
 * makes relay lowest-ranked, but rank only orders pairs that finish checking together
 * — in practice a relay pair often validates first and then keeps the connection for
 * its whole life. Measured between two tabs on one machine, every session went through
 * the relay despite an obvious direct path. Withholding the relay until a *failure* was
 * tried and reverted: ICE can sit in "checking" indefinitely without ever failing. A
 * deadline is the only trigger that actually fires, so the first attempt runs without
 * relay servers and this timer brings them into the same connection if nothing has
 * opened in time. Direct connections have measured 1–3 s; this leaves headroom.
 */
const RELAY_AFTER_MS = 6_000;

/** Endings where a paired device was never reached, so calling it again can still work. */
const DEVICE_RETRY_REASONS: ReadonlySet<MessageKey> = new Set([
  "error.deviceUnreachable",
  "error.peerGone",
  "error.deviceBusy",
]);

/** What a failed session was trying to deliver, kept so it can be tried again. */
interface RetryTarget {
  /** The paired device that was called; null for a code that expired unused. */
  device: string | null;
  files: File[];
  text: string | null;
}

interface Credentials {
  code: string;
  sessionKey: string;
  role: Role;
}

/** Sent over the signalling relay so each side can tell a blip from a reload. */
interface InstanceAnnouncement {
  instance: string;
}

/**
 * Sent by the side that offers, just before it restarts ICE with the relay. The other
 * side gathers its candidates for that restart from whatever servers it holds by then,
 * and without the hint it could still be on the direct-only list, so only one end would
 * ever reach the relay.
 */
interface RelayHint {
  relay: true;
}

/**
 * Every message between paired devices names the session it belongs to. The rendezvous
 * room outlives any one session, so without this a device still retrying a connection
 * the other side had already ended looked exactly like a device calling afresh.
 */
interface GroupEnvelope {
  session: string;
  /** Opens a session. Nothing else may, so leftovers of an old one can never start one. */
  call?: true;
  /** This side has ended the session and will not answer again. */
  bye?: true;
  /** The call was refused because this device is already in a session. */
  busy?: true;
  /** The call arrived and is being answered, so the caller can stop repeating it. */
  ack?: true;
  /** A WebRTC signal for the session. */
  data?: unknown;
}

export class GSendClient {
  private readonly signaling: Signaling;
  private readonly transfer: TransferEngine;
  private readonly group: GroupLink;
  private peer: PeerLink | null = null;

  /**
   * Identifies this page load. A peer that comes back with a different id has a brand
   * new RTCPeerConnection, so our half of the old one can never be revived.
   */
  private readonly instanceId = crypto.randomUUID();
  private remoteInstance: string | null = null;

  private phase: Phase = "idle";
  private role: Role | null = null;
  private credentials: Credentials | null = null;
  private joinExpiresAt: number | null = null;
  private peerPresent = false;
  private peerAbsentSince: number | null = null;
  private connection: PeerState = "new";
  private channelsOpen = false;
  private peerJoinedAt: number | null = null;
  private mode: Mode = "code";
  private identity: Identity | null = null;
  private paired: KnownDevice[] = [];
  private presence = new Set<string>();
  private peerDevice: string | null = null;
  /** Names the device session in progress, so its messages can be told from stale ones. */
  private groupSession: string | null = null;
  /** This side placed the call, rather than answering one. Settles two calls crossing. */
  private groupCaller = false;
  /** The other device has been heard from in this session, so the call got through. */
  private groupAnswered = false;
  private callAttempts = 0;
  private callTimer: ReturnType<typeof setTimeout> | null = null;
  private groupAbsenceTimer: ReturnType<typeof setTimeout> | null = null;
  private handshake: Handshake | null = null;
  /**
   * Control messages that arrived before they could be handled: a claim before this
   * side had started its own half of the handshake, or anything for the transfer engine
   * before the peer had finished proving itself. The peer can finish verifying this side
   * first and start sending straight away, and dropping its opening offer meant a
   * session that connected, verified, and then never moved a byte.
   */
  private heldControl: string[] = [];
  private verified = false;
  /** How far this code session has got towards the two devices remembering each other. */
  private pairOffer: PairOffer | null = null;
  /** The name the peer gave when it proved itself. */
  private peerName: string | null = null;
  /**
   * The person here asked to remember the peer. Kept by the session rather than the
   * handshake, because a handshake cut off by a reconnect starts over and is asked again.
   */
  private wantPair = false;
  private woken = false;
  /** Kept so a group session can attach the engine once the peer has proved itself. */
  private openChannels: PeerChannels | null = null;
  /**
   * Signals that arrived before there was a connection to give them to. Building one
   * waits on relay credentials, and a device session starts building only *because* a
   * signal arrived — so the offer that opened it would otherwise be the one dropped,
   * and only the offering side creates channels, so nothing would ever follow it.
   */
  private pendingSignals: unknown[] = [];
  private texts: TextMessage[] = [];
  private pendingFiles: File[] = [];
  private pendingText: string | null = null;
  private retryTarget: RetryTarget | null = null;
  private notice: Message | null = null;
  private error: Message | null = null;
  /** A "save all" is still handing files over; a second press would repeat them. */
  private savingAll = false;

  private closedByUser = false;
  private reconnectAttempt = 0;
  /** Retry until this moment, matching how long the server keeps the room. */
  private reconnectDeadline: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private peerTimer: ReturnType<typeof setTimeout> | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private failureTimer: ReturnType<typeof setTimeout> | null = null;
  private statReported = false;
  private iceServersPromise: Promise<IceServer[]> | null = null;
  private resolveIceServers: ((servers: IceServer[]) => void) | null = null;
  private startingPeer = false;
  /** Bumped by every reset, so work begun for one session cannot land in the next. */
  private sessionEpoch = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private escalateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Everything the server offered, relay included, kept for escalation. */
  private iceServersFull: IceServer[] | null = null;
  /** Once true, every connection this session builds starts with the relay in play. */
  private relayNeeded = false;
  /** The direct attempt ran out of time, so the relay goes in as soon as there is one to add. */
  private relayDue = false;
  private path: ConnectionPath | null = null;

  private listeners = new Set<() => void>();
  /** Built at the end of the constructor, once the engines it reads from exist. */
  private snapshot!: Snapshot;

  constructor() {
    this.signaling = new Signaling({
      onOpen: () => {
        this.reconnectAttempt = 0;
        this.reconnectDeadline = null;
      },
      onMessage: (msg) => this.onServerMessage(msg),
      onClose: (code) => this.onSignalingClosed(code),
    });

    this.transfer = new TransferEngine({
      sendControl: (msg) => this.peer?.sendControl(JSON.stringify(msg)) ?? false,
      onChange: () => this.emitSoon(),
      onText: (msg) => {
        this.texts = [...this.texts, msg];
        this.emitNow();
      },
      onTransfersChanged: () => this.persist(),
    });

    this.group = new GroupLink({
      onPresence: (peers) => {
        this.presence = new Set(peers);
        this.watchGroupPeer();
        this.emitNow();
      },
      onSignal: (peer, data) => this.onGroupSignal(peer, data),
      onIce: (servers) => this.deliverIceServers(servers),
      onOffline: () => this.emitNow(),
    });

    this.installLifecycleHandlers();
    this.snapshot = this.build();
  }

  // --- paired devices ------------------------------------------------------

  /**
   * Load this device's identity and go online for the devices it already knows. Called
   * once at startup, before anything else: the device list is the first thing on screen
   * and joining the rendezvous room is what makes it true.
   */
  async wake(): Promise<void> {
    // Guarded here rather than by the caller: going online is about this client, not
    // about which entry path the page took, and a second call would only churn the socket.
    if (this.woken) return;
    this.woken = true;

    // A folder granted on an earlier visit means an incoming file needs no clicks at
    // all, which is the point of remembering a device in the first place.
    await restoreSaveDirectory();
    this.emitNow();

    this.identity = await loadIdentity();
    if (!this.identity) return;

    this.paired = await knownDevices();
    this.emitNow();
    await this.goOnline();
  }

  private async goOnline(): Promise<void> {
    if (!this.identity) return;
    const secret = await groupSecret();
    if (!secret) return;
    this.group.start(secret, this.identity.id);
  }

  private async refreshDevices(): Promise<void> {
    this.paired = await knownDevices();
    this.emitNow();
    // A pairing may have just created or changed the group, which is what the
    // rendezvous room is derived from, so the socket has to be pointed at the new one.
    // Pointing it at the room it is already in is a no-op: the device session being
    // verified here signals through that very socket.
    await this.goOnline();
  }

  /** Take the room back from another tab or window of this browser. */
  useThisTab(): void {
    this.group.wake(true);
  }

  async rename(name: string): Promise<void> {
    this.identity = await renameDevice(name);
    this.emitNow();
  }

  /** Call a paired device something else here; the other device is not told. */
  async renamePeer(id: string, name: string): Promise<void> {
    await renameKnownDevice(id, name);
    this.paired = await knownDevices();
    this.emitNow();
  }

  async unpair(id: string): Promise<void> {
    await forgetDevice(id);
    this.paired = await knownDevices();
    this.emitNow();
  }

  /** Leave the group entirely: stop being findable, and forget every paired device. */
  async unpairAll(): Promise<void> {
    this.group.stop();
    await forgetGroup();
    // Forgetting the devices means forgetting where their files were going, too.
    await forgetSaveDirectory();
    this.paired = [];
    this.presence.clear();
    this.emitNow();
  }

  /**
   * Open a session with a device from the list. No code is involved, so the peer has to
   * prove which device it is before anything moves; `verified` is what gates that.
   */
  connectToDevice(id: string, files: File[] = [], text: string | null = null): void {
    if (!this.identity) return;
    const device = this.paired.find((known) => known.id === id);
    if (!device || !this.presence.has(id)) return;

    this.resetSession();
    // Set after resetSession, which would otherwise clear them.
    this.pendingFiles = files;
    this.pendingText = tidyText(text);
    this.mode = "group";
    this.peerDevice = id;
    this.groupSession = crypto.randomUUID();
    this.groupCaller = true;
    // No host and guest here, so the tie is broken by id. Both sides read it the same
    // way, which is all perfect negotiation needs to settle offer collisions.
    this.role = this.identity.id < id ? "host" : "guest";
    this.phase = "pairing";
    this.peerPresent = true;
    this.emitNow();
    // Said outright rather than left to the first offer: when this side is the guest it
    // makes no offer, and the other device would never learn it was being called.
    this.placeCall();
    void this.startPeer();
  }

  /**
   * Ring the other device, and keep ringing until it answers. Its socket can be a moment
   * away from reconnecting — waking from the background, moving to the next room — and a
   * call sent into that gap used to vanish, leaving this side on "Connecting" for good.
   * A device that never answers is reported as such rather than waited on forever.
   */
  private placeCall(): void {
    const session = this.groupSession;
    const peer = this.peerDevice;
    if (!session || !peer || this.groupAnswered) return;
    if (this.callAttempts >= CALL_ATTEMPTS) {
      this.end({ key: "error.deviceUnreachable" });
      return;
    }

    this.callAttempts += 1;
    this.group.send(peer, { session, call: true } satisfies GroupEnvelope);
    if (this.callAttempts > 1) {
      // A call that went unheard took the opening offer with it. Sent after the call,
      // which is what tells the other side the offer is for a session it knows.
      this.peer?.resendOffer();
      // The relay credentials are asked for through the same socket, and may have been
      // lost the same way; without them a connection that needs the relay cannot happen.
      if (!offersRelay(this.iceServersFull)) this.group.requestIce();
    }
    this.callTimer = setTimeout(() => {
      this.callTimer = null;
      this.placeCall();
    }, CALL_RETRY_MS);
  }

  /** The other device has been heard from in this session: the call is through. */
  private onCallAnswered(): void {
    if (this.mode !== "group" || this.groupAnswered) return;
    this.groupAnswered = true;
    this.clearCallTimer();
    // Its half of the connection starts now, so this is when the direct attempt's
    // allowance starts too; counted from the first ring, a slow answer used it up.
    this.armRelayDeadline();
  }

  private clearCallTimer(): void {
    if (this.callTimer) clearTimeout(this.callTimer);
    this.callTimer = null;
  }

  /**
   * A message arrived from a paired device. Only an explicit call opens a session, and
   * only on a device that is not already in one: answering anything else used to let a
   * device still retrying a session that had ended here tear down whatever this one had
   * moved on to, a code session included.
   */
  private onGroupSignal(peer: string, raw: unknown): void {
    const msg = raw as Partial<GroupEnvelope> | null;
    if (!msg || typeof msg.session !== "string") return;

    if (msg.session === this.groupSession) {
      if (peer !== this.peerDevice) return;
      if (msg.bye || msg.busy) {
        // Over on their side already, so there is nobody left to say goodbye to.
        this.groupSession = null;
        this.end({ key: msg.busy ? "error.deviceBusy" : "error.peerEnded" });
        return;
      }
      // Anything at all for this session, an answer or the first signal, means it rang.
      this.onCallAnswered();
      // The caller is still ringing, so the answer it was sent went missing; repeat it.
      if (msg.call && !this.groupCaller) {
        this.group.send(peer, { session: msg.session, ack: true } satisfies GroupEnvelope);
      }
      if (msg.data !== undefined) this.onSignal(msg.data);
      return;
    }

    if (!msg.call) return;
    if (!this.identity || !this.paired.some((known) => known.id === peer)) return;
    if (this.phase !== "idle" && this.phase !== "ended" && !this.callReplaces(peer, msg.session)) {
      // Two devices calling each other at once each see the other's call here. The one
      // that keeps its own call says nothing: the other side is already moving over.
      const crossed = this.mode === "group" && this.groupCaller && peer === this.peerDevice;
      if (!crossed) this.group.send(peer, { session: msg.session, busy: true } satisfies GroupEnvelope);
      return;
    }

    this.resetSession();
    this.mode = "group";
    this.peerDevice = peer;
    this.groupSession = msg.session;
    this.groupAnswered = true;
    this.role = this.identity.id < peer ? "host" : "guest";
    this.phase = "pairing";
    this.peerPresent = true;
    this.emitNow();
    // Answered before anything else, so the caller stops ringing at once.
    this.group.send(peer, { session: msg.session, ack: true } satisfies GroupEnvelope);
    void this.startPeer();
  }

  /**
   * Whether a call should take over the session this device is already in. Only ever a
   * call from the same device: it calls again only once it has given up on the session
   * it started before, so refusing it as busy left this side waiting on a session the
   * other had abandoned, and that side unable to reach it until someone ended it by hand.
   * A session that is up and carrying data is never replaced. When both devices call
   * each other at the same moment, both keep the smaller session id and so agree.
   */
  private callReplaces(peer: string, session: string): boolean {
    if (this.mode !== "group" || peer !== this.peerDevice || !this.groupSession) return false;
    if (this.channelsOpen && this.peer?.transportConnected) return false;
    if (!this.groupCaller) return true;
    return session < this.groupSession;
  }

  /**
   * Tell the paired device this session is over. Without it the other side cannot tell
   * an ending from a dropped connection, and keeps retrying into the rendezvous room.
   */
  private hangUp(): void {
    const session = this.groupSession;
    this.groupSession = null;
    this.clearCallTimer();
    if (!session || !this.peerDevice) return;
    this.group.send(this.peerDevice, { session, bye: true } satisfies GroupEnvelope);
  }

  /**
   * A device session has no server room to say the other side left, so the rendezvous
   * presence stands in for it: a peer missing from the room while the connection is
   * still not up is not going to finish it. Short absences are forgiven, and so is our
   * own socket being down, which empties the list without saying anything about them.
   */
  private watchGroupPeer(): void {
    const peer = this.peerDevice;
    const waiting = this.mode === "group" && this.phase === "pairing" && !this.channelsOpen && peer !== null;
    if (!waiting || this.presence.has(peer) || !this.group.online) {
      if (this.groupAbsenceTimer) clearTimeout(this.groupAbsenceTimer);
      this.groupAbsenceTimer = null;
      return;
    }
    if (this.groupAbsenceTimer) return;
    this.groupAbsenceTimer = setTimeout(() => {
      this.groupAbsenceTimer = null;
      if (this.mode !== "group" || this.phase !== "pairing" || this.channelsOpen) return;
      if (!this.peerDevice || this.presence.has(this.peerDevice)) return;
      this.end({ key: "error.peerGone" });
    }, GROUP_ABSENCE_MS);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  // --- commands ------------------------------------------------------------

  /**
   * Reserve a code for the files and text already picked. Choosing first and pairing
   * second is what lets the other device receive on arrival: by the time it joins, the
   * queue is known and the transfer can start the moment the channels open. Calling
   * this with nothing staged is still valid — it opens a session to receive into.
   */
  host(files: File[] = [], text: string | null = null): void {
    this.resetSession();
    this.phase = "creating";
    this.role = "host";
    // Set after resetSession, which would otherwise clear them.
    this.pendingFiles = files;
    this.pendingText = tidyText(text);
    this.emitNow();
    this.signaling.connect({ role: "host" });
  }

  join(code: string): void {
    if (!isValidCode(code)) {
      this.error = { key: "error.badCode" };
      this.emitNow();
      return;
    }
    this.resetSession();
    this.phase = "joining";
    this.role = "guest";
    this.emitNow();
    this.signaling.connect({ role: "guest", code });
  }

  /** Rejoin the room this tab was in before it reloaded. */
  restore(): boolean {
    const stored = loadSession();
    if (!stored) return false;

    this.resetSession();
    this.role = stored.role;
    this.credentials = {
      code: stored.code,
      sessionKey: stored.sessionKey,
      role: stored.role,
    };
    this.phase = "pairing";
    this.reconnectDeadline = Date.now() + RESUME_GRACE_MS;
    this.persist();
    this.emitNow();

    // Reopen the partly received files before reconnecting: the offsets we report on
    // attach come from those files, and an empty report tells the sender to give up.
    void this.transfer
      .restore(stored.incoming, stored.outgoing)
      .finally(() => this.resumeSignaling());

    return true;
  }

  /**
   * Take files from the system share sheet. Sharing to GSend is a statement of intent,
   * so an idle app opens a session for them immediately and shows the code.
   */
  stageShared(files: File[], text: string | null): void {
    if (this.phase === "idle") {
      this.host(files, text);
      return;
    }
    this.pendingFiles = files;
    this.pendingText = tidyText(text);
    this.flushPendingShare();
    this.emitNow();
  }

  /** The queue goes out as soon as there is something to carry it. */
  private flushPendingShare(): void {
    if (!this.channelsOpen || !this.trusted()) return;

    if (this.pendingFiles.length > 0) {
      this.transfer.sendFiles(this.pendingFiles);
      this.pendingFiles = [];
    }
    if (this.pendingText !== null) {
      this.transfer.sendText(this.pendingText);
      this.pendingText = null;
    }
  }

  sendFiles(files: File[]): void {
    if (!this.channelsOpen) {
      // Queued rather than dropped: the connection may still be coming up.
      this.pendingFiles = [...this.pendingFiles, ...files];
      this.emitNow();
      return;
    }
    this.transfer.sendFiles(files);
    this.emitNow();
  }

  sendText(body: string): void {
    const tidy = tidyText(body);
    if (!tidy) return;
    if (!this.channelsOpen) {
      this.pendingText = this.pendingText ? `${this.pendingText}
${tidy}` : tidy;
      this.emitNow();
      return;
    }
    this.transfer.sendText(tidy);
  }

  /**
   * Pick where arriving files should be written. Must be called straight from a click:
   * the picker needs transient user activation. Files already in flight keep the sink
   * they started with; everything offered afterwards goes to the new folder.
   */
  async chooseFolder(): Promise<void> {
    const choice = await chooseSaveDirectory();
    // Coming back from the picker with nothing usually means the browser refused the
    // folder for holding system files. It says so inside its own dialog and then
    // vanishes, so this is the only place left to explain what to pick instead.
    if (choice.picked) this.notice = null;
    else if (choice.dismissed) this.notice = { key: "notice.folderBlocked" };
    this.emitNow();
  }

  cancelTransfer(fileId: string): void {
    this.transfer.cancel(fileId);
  }

  /** The row's own save link was pressed; the browser does the rest. */
  markSaved(fileId: string): void {
    this.transfer.markDownloaded(fileId);
  }

  /**
   * Save every finished file that has not been saved yet, in one press. Must be called
   * straight from a click, for the same user-activation reason as the folder picker.
   */
  async saveAll(): Promise<void> {
    if (this.savingAll) return;
    this.savingAll = true;
    try {
      const waiting = this.transfer.unsavedDownloads();
      const route = await saveFiles(waiting, (id, savedAs) =>
        this.transfer.markDownloaded(id, savedAs ?? undefined),
      );
      // Only the download route can lose files without saying so: the browser asks
      // before the second one and drops the rest until that has been answered.
      if (route === "download" && waiting.length > 1) {
        this.notice = { key: "notice.multiDownload" };
        this.emitNow();
      } else if (route === "no-folder") {
        this.notice = { key: "notice.folderBlocked" };
        this.emitNow();
      }
    } finally {
      this.savingAll = false;
    }
  }

  /**
   * Ask to remember the device at the other end of this code session. Nothing is
   * recorded until the person there asks too.
   */
  rememberPeer(): void {
    if (this.mode !== "code" || this.wantPair) return;
    this.wantPair = true;
    this.handshake?.consent();
  }

  dismissNotice(): void {
    this.notice = null;
    this.emitNow();
  }

  leave(): void {
    this.closedByUser = true;
    this.reportGiveUp();
    this.signaling.send({ t: "bye" });
    this.end(null);
  }

  /**
   * Someone waiting on a connection that never arrives gives up long before ICE admits
   * defeat, so without this the failures that matter most never reach the counters —
   * which is exactly the number the TURN decision rests on.
   */
  private reportGiveUp(): void {
    if (this.statReported) return;
    if (this.channelsOpen) {
      // Connected, but ended before the settle timer fired; the path is still worth
      // recording even if it had not fully quiesced. The route measured when the
      // channels opened goes as it stands: measuring again would finish after end()
      // has closed the socket, and the count would be lost.
      this.statReported = true;
      this.sendStat("connected", this.path ?? "unknown");
      return;
    }
    if (this.phase !== "pairing" && this.phase !== "joining") return;
    this.statReported = true;
    // Sent directly rather than through reportStat, whose await would land after the
    // socket has already been closed by end().
    this.sendStat("failed", "unknown");
  }

  /**
   * A code session's room keeps one count per session whoever reports it. A device
   * session has no such room, and both devices see the same connection, so only the
   * side that offered reports it.
   */
  private sendStat(outcome: ConnectionOutcome, path: ConnectionPath): void {
    if (this.mode === "group") {
      if (this.role === "host") this.group.sendStat(outcome, path);
      return;
    }
    this.signaling.send({ t: "stat", outcome, path });
  }

  // --- signalling ----------------------------------------------------------

  private onServerMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "hello":
        this.onHello(msg);
        break;

      case "peer-joined":
      case "peer-resumed":
        this.peerPresent = true;
        this.clearPeerAbsence();
        if (this.phase === "hosting") this.phase = "pairing";
        // The departure that preceded this marked the connection as reconnecting, and
        // with the bytes still flowing nothing else was going to take that back.
        if (this.channelsOpen && this.peer?.transportConnected) this.connection = "connected";
        this.announceInstance();
        this.emitNow();
        break;

      case "peer-left":
        this.onPeerLeft();
        break;

      case "signal":
        this.onSignal(msg.data);
        break;

      case "ice":
        this.deliverIceServers(msg.iceServers);
        break;

      case "code-expired":
        this.end({ key: "error.nobodyJoined" });
        break;

      case "closed":
        this.end({ key: msg.reason === "peer-left" ? "error.peerEnded" : "error.sessionIdle" });
        break;

      case "error":
        this.onServerError(msg.code);
        break;
    }
  }

  private onHello(msg: Extract<ServerMessage, { t: "hello" }>): void {
    this.role = msg.role;
    this.credentials = { code: msg.code, sessionKey: msg.sessionKey, role: msg.role };
    this.joinExpiresAt = msg.joinExpiresAt;
    this.peerPresent = msg.peerPresent;
    this.error = null;
    this.persist();

    // A signalling reconnect says nothing about the peer connection, which usually
    // outlives it. Knocking a connected session back to "pairing" here hid the
    // transfer list while bytes were still arriving underneath it.
    const established = this.channelsOpen;
    if (established) {
      this.phase = "active";
      // The bar was left saying "Reconnecting" by the signalling drop even though the
      // peer connection carrying the bytes never went anywhere.
      this.connection = "connected";
    } else if (msg.role === "host") {
      this.phase = msg.peerPresent ? "pairing" : "hosting";
    } else {
      this.phase = "pairing";
    }

    // Warm the credentials now so a peer arriving later does not wait on them.
    void this.requestIceServers();

    if (msg.peerPresent) {
      this.clearPeerAbsence();
      // Announced before any offer so the peer can rebuild first if we are new to it.
      this.announceInstance();
      void this.startPeer();
    }

    this.emitNow();
  }

  private onServerError(code: ServerErrorCode): void {
    const wasPaired = this.phase === "active" || this.phase === "pairing";
    const expired = code === "code_not_found" || code === "bad_key" || code === "session_full";

    this.closedByUser = true;
    // Mid-session these all mean the same thing to a person: the room is gone.
    this.error = wasPaired && expired
      ? { key: "error.expiredWhileAway" }
      : { key: `server.${code}` as const };
    this.phase = this.phase === "joining" ? "idle" : "ended";
    clearSession();
    this.emitNow();
  }

  private onSignalingClosed(code: number): void {
    if (this.closedByUser || this.phase === "idle" || this.phase === "ended") return;

    // 4000-range closes are deliberate refusals; the error message already arrived.
    if (code >= 4000 && code < 4100) return;

    if (!this.credentials) {
      this.end({ key: "error.serverLost" });
      return;
    }

    const now = Date.now();
    if (this.reconnectDeadline === null) this.reconnectDeadline = now + RESUME_GRACE_MS;
    if (now >= this.reconnectDeadline) {
      this.end({ key: "error.serverLost" });
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt += 1;
    this.connection = "reconnecting";
    this.emitNow();

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this.resumeSignaling(), delay);
  }

  private resumeSignaling(): void {
    const creds = this.credentials;
    if (!creds) return;
    this.signaling.connect({
      role: "resume",
      code: creds.code,
      key: creds.sessionKey,
      as: creds.role,
    });
  }

  // --- peer identity -------------------------------------------------------

  /**
   * Signals reach the peer over whichever transport this session was built on: the
   * room named by a 4-digit code, or the rendezvous room the paired devices derive.
   * Everything above this line is identical either way.
   */
  private sendSignal(data: unknown): void {
    if (this.mode === "group") {
      if (this.peerDevice && this.groupSession) {
        this.group.send(this.peerDevice, { session: this.groupSession, data } satisfies GroupEnvelope);
      }
      return;
    }
    this.signaling.send({ t: "signal", data });
  }

  private requestIceServers(): Promise<IceServer[]> {
    if (this.iceServersPromise) return this.iceServersPromise;

    this.iceServersPromise = new Promise<IceServer[]>((resolve) => {
      this.resolveIceServers = resolve;
      if (this.mode === "group") this.group.requestIce();
      else this.signaling.send({ t: "ice" });
      setTimeout(() => {
        // Only this request's own fallback: a timer left over from an earlier session
        // must not answer the one that replaced it.
        if (this.resolveIceServers !== resolve) return;
        this.resolveIceServers = null;
        this.iceServersFull ??= STUN_ONLY;
        resolve(STUN_ONLY);
      }, ICE_REQUEST_TIMEOUT_MS);
    });
    return this.iceServersPromise;
  }

  private deliverIceServers(servers: IceServer[]): void {
    // A real reply is always kept for escalation, even one that lands after the
    // fallback has already let the connection start on STUN: it is the only place the
    // relay can come from. The fallback, for its part, never overwrites a real reply —
    // that once left escalation convinced there was no relay to add.
    const resolved = servers.length > 0 ? servers : STUN_ONLY;
    this.iceServersFull = resolved;

    const resolve = this.resolveIceServers;
    this.resolveIceServers = null;
    resolve?.(resolved);

    // The direct attempt already ran out of time while there was nothing to add.
    if (this.relayDue && !this.channelsOpen) this.engageRelay();
  }

  private announceInstance(): void {
    this.sendSignal({ instance: this.instanceId });
  }

  private onSignal(data: unknown): void {
    const control = data as Partial<InstanceAnnouncement & RelayHint> | null;
    if (control && typeof control.instance === "string") {
      this.onRemoteInstance(control.instance);
      return;
    }
    if (control?.relay === true) {
      // Remembered, so relay servers that arrive only after this are put in on arrival.
      this.relayDue = true;
      this.engageRelay();
      return;
    }
    if (!this.peer) {
      this.pendingSignals.push(data);
      return;
    }
    void this.peer.handleSignal(data);
  }

  private onRemoteInstance(id: string): void {
    const previous = this.remoteInstance;
    this.remoteInstance = id;
    this.peerPresent = true;
    this.clearPeerAbsence();
    if (this.phase === "hosting") this.phase = "pairing";

    if (previous !== null && previous !== id) {
      // The peer reloaded. Its DTLS identity changed, so ICE restart cannot revive
      // our data channels — the whole connection has to be built again.
      this.rebuildPeer();
    } else {
      this.revivePeer();
    }

    this.emitNow();
  }

  /**
   * The peer is reachable again but our channels are not. An ICE restart is enough for
   * a connection that is merely struggling; one that has actually closed can only be
   * replaced, and leaving it be is what strands a session on "Connecting" forever.
   */
  private revivePeer(): void {
    // Nobody to connect to yet. A host waiting for its code to be entered used to build
    // a connection into the void whenever its window regained focus, and the relay
    // deadline then ran out on it — so the guest, arriving later, was met by a session
    // that had already committed itself to the relay, and every transfer crawled.
    if (!this.peerPresent) return;
    if (!this.peer) {
      void this.startPeer();
      return;
    }
    if (this.channelsOpen) return;
    if (this.connection === "closed" || this.connection === "failed") this.rebuildPeer();
    else this.peer.restart();
  }

  private onPeerLeft(): void {
    this.peerPresent = false;
    this.peerAbsentSince = Date.now();
    if (this.phase === "active" || this.phase === "pairing") this.connection = "reconnecting";

    if (this.peerTimer) clearTimeout(this.peerTimer);
    this.peerTimer = setTimeout(() => {
      this.peerTimer = null;
      if (this.peerPresent) return;
      this.end({ key: "error.peerGone" });
    }, RESUME_GRACE_MS);

    this.emitNow();
  }

  private clearPeerAbsence(): void {
    this.peerAbsentSince = null;
    if (this.peerTimer) {
      clearTimeout(this.peerTimer);
      this.peerTimer = null;
    }
  }

  // --- peer ----------------------------------------------------------------

  /**
   * Relay credentials come from the server, so this waits for them — but only briefly.
   * A connection that could have worked over STUN must not be blocked by a relay it may
   * never need.
   */
  private async startPeer(): Promise<void> {
    if (this.peer || this.startingPeer || !this.role) return;
    this.startingPeer = true;
    const epoch = this.sessionEpoch;

    let iceServers: IceServer[];
    try {
      iceServers = await this.requestIceServers();
    } finally {
      if (epoch === this.sessionEpoch) this.startingPeer = false;
    }

    // The session this was started for may have ended while the servers were awaited.
    if (epoch !== this.sessionEpoch || this.peer || !this.role) return;

    const forceRelay = isRelayForced();
    if (forceRelay) this.relayNeeded = true;
    if (!this.relayNeeded) iceServers = withoutRelay(iceServers);

    this.peer = new PeerLink(this.role, iceServers, {
      onSignal: (data) => this.sendSignal(data),
      onState: (state) => {
        this.connection = state;
        if (state === "failed") {
          // A definitive failure needs no deadline; bring the relay in at once.
          this.engageRelay();
          this.scheduleFailureStat();
        }
        // A restart can land on a different route from the one before it.
        if (state === "connected") void this.measurePath();
        this.emitNow();
      },
      onChannels: (channels) => this.onChannels(channels),
      onChannelsLost: () => {
        this.channelsOpen = false;
        this.openChannels = null;
        this.transfer.detach();
        this.forgetUnfinishedHandshake();
        this.emitNow();
      },
      onControlMessage: (raw) => this.onPeerControl(raw),
      onDataFrame: (frame) => {
        if (!this.trusted()) return;
        this.transfer.handleFrame(frame);
      },
    }, forceRelay);

    this.peer.start();

    const queued = this.pendingSignals;
    this.pendingSignals = [];
    for (const data of queued) void this.peer.handleSignal(data);

    // A device that has not answered the call yet is not trying to connect, so its
    // silence is no evidence against a direct route. The clock starts when it answers.
    if (this.mode === "code" || this.groupAnswered) this.armRelayDeadline();
  }

  private armRelayDeadline(): void {
    if (this.relayNeeded || this.escalateTimer || !this.peer || this.channelsOpen) return;
    this.escalateTimer = setTimeout(() => {
      this.escalateTimer = null;
      if (this.channelsOpen) return;
      this.relayDue = true;
      this.engageRelay();
    }, RELAY_AFTER_MS);
  }

  /**
   * The direct attempt has had its chance; add the relay to the running connection.
   * Direct pairs keep being checked and still win when they work, so this widens the
   * search rather than redirecting it.
   */
  private engageRelay(): void {
    if (this.relayNeeded) return;

    const full = this.iceServersFull;
    if (!full || !offersRelay(full)) return;

    this.relayNeeded = true;
    this.clearEscalateTimer();
    if (!this.peer || this.channelsOpen) return;

    // The offering side restarts ICE, and the other side gathers for that restart from
    // whatever servers it holds by then, so it is told to take the relay on first.
    if (this.role === "host") this.sendSignal({ relay: true } satisfies RelayHint);

    // Rebuild only for a browser whose setConfiguration cannot do it in place; the
    // rebuilt peer starts with the full list because relayNeeded is already set.
    if (!this.peer.escalate(full)) this.rebuildPeer();
  }

  private clearEscalateTimer(): void {
    if (this.escalateTimer) clearTimeout(this.escalateTimer);
    this.escalateTimer = null;
  }

  private rebuildPeer(): void {
    this.peer?.close();
    this.peer = null;
    this.channelsOpen = false;
    this.path = null;
    this.connection = "connecting";
    this.forgetUnfinishedHandshake();
    // Detached explicitly: the discarded link no longer reports its own closure, and
    // without this the sender would keep its old send offsets instead of waiting for
    // the peer to say where to pick up.
    this.transfer.detach();
    // Transfers are not abandoned here. The reloaded peer reopens its files and reports
    // where to resume; anything it could not recover it cancels explicitly.
    void this.startPeer();
  }

  private onChannels(channels: PeerChannels): void {
    this.channelsOpen = true;
    this.clearEscalateTimer();
    // Open channels are proof the peer is here, whatever the signalling said earlier.
    this.clearPeerAbsence();
    this.peerPresent = true;
    this.openChannels = channels;
    this.onCallAnswered();
    this.watchGroupPeer();
    void this.measurePath();
    // A group session holds the engine back until the peer has proved itself; a code
    // session has already been vouched for by the person who read out the digits.
    if (this.trusted()) this.transfer.attach(channels);
    this.startHandshake();

    if (this.failureTimer) {
      clearTimeout(this.failureTimer);
      this.failureTimer = null;
    }
    if (!this.statReported && !this.settleTimer) {
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        void this.reportStat("connected");
      }, PATH_SETTLE_MS);
    }

    // Open channels are the whole gate for a code session: whoever staged something
    // sends it here, and the other side is already receiving into the folder it picked.
    if (this.trusted()) {
      this.phase = "active";
      this.peerJoinedAt ??= Date.now();
      this.persist();
      this.flushPendingShare();
    }
    this.emitNow();
  }

  /** Whether this session may carry anything yet. */
  private trusted(): boolean {
    return this.mode === "code" || this.verified;
  }

  /**
   * Both sides announce themselves the moment the control channel is up. In a code
   * session this only makes a pairing possible and never blocks the transfer, so a peer
   * running an older build still works; in a group session it is the gate.
   */
  private startHandshake(): void {
    const identity = this.identity;
    if (!identity || this.handshake) return;

    this.handshake = new Handshake(identity, this.mode, {
      send: (msg) => this.peer?.sendControl(JSON.stringify(msg)),
      onVerified: (device) => {
        this.verified = true;
        this.peerName = this.paired.find((known) => known.id === device.id)?.alias ?? device.name;
        // A paired device's name is kept current each time the two meet, by code or not.
        if (this.mode === "group") void this.refreshDevices();
        else
          void knownDevices().then((devices) => {
            this.paired = devices;
            this.emitNow();
          });
        // Asked before a reconnect made the proof start over; the answer still stands.
        if (this.wantPair) this.handshake?.consent();

        if (this.openChannels) this.transfer.attach(this.openChannels);
        this.phase = "active";
        this.peerJoinedAt ??= Date.now();
        // Whatever the peer sent while it was still unproved goes through first, in
        // order, ahead of anything this side now sends.
        this.releaseHeldControl();
        this.flushPendingShare();
        this.emitNow();
      },
      onPairing: (offer) => {
        this.pairOffer = offer;
        this.emitNow();
      },
      onPaired: (stranded) => {
        this.pairOffer = "paired";
        if (stranded > 0) this.notice = { key: "notice.regrouped", params: { count: stranded } };
        // The pairing may have just created or changed the group this device goes online in.
        void this.refreshDevices();
      },
      onRejected: () => {
        this.heldControl = [];
        // Only reachable in group mode, where an unproved peer has no business here.
        if (this.mode === "group") this.end({ key: "error.unknownDevice" });
      },
    });
    void this.handshake.begin();
    // The peer's claim may have arrived before this side's channels both reported open.
    this.releaseHeldControl();
  }

  /**
   * A handshake cut off by the channels closing would wait forever for messages that
   * went down with them, and a device session would never be allowed to carry anything.
   * One that had not finished is dropped, so the next channels start it afresh. A code
   * session's is finished only once it has paired: the other side may have reloaded and
   * be proving itself from scratch, and an offer to pair it could not answer would wait
   * for ever.
   */
  private forgetUnfinishedHandshake(): void {
    const finished = this.mode === "group" ? this.verified : this.pairOffer === "paired";
    if (finished) return;
    this.handshake = null;
    this.heldControl = [];
    this.verified = false;
    this.pairOffer = null;
  }

  private onPeerControl(raw: string): void {
    let msg: PeerControl;
    try {
      msg = JSON.parse(raw) as PeerControl;
    } catch {
      return;
    }

    if (isHandshakeMessage(msg)) {
      // The channels open on the two sides a moment apart, so the peer's claim can
      // arrive before this side has begun its own half; dropped, the pairing never
      // completed and a device session never verified.
      if (this.handshake) this.handshake.handle(msg);
      else this.holdControl(raw);
      return;
    }

    // A device session lets nothing reach the transfer engine until the peer has proved
    // itself. The peer can finish verifying this side first and send its offer at once,
    // so that offer waits here rather than being thrown away.
    if (!this.trusted()) {
      this.holdControl(raw);
      return;
    }
    this.transfer.handleControl(raw);
  }

  private holdControl(raw: string): void {
    if (this.heldControl.length < MAX_HELD_CONTROL) this.heldControl.push(raw);
  }

  /** Hand over whatever can now be handled; anything that still cannot is held again, in order. */
  private releaseHeldControl(): void {
    const held = this.heldControl;
    if (held.length === 0) return;
    this.heldControl = [];
    for (const raw of held) this.onPeerControl(raw);
  }

  // --- connection metrics --------------------------------------------------

  private scheduleFailureStat(): void {
    if (this.statReported || this.failureTimer) return;
    this.failureTimer = setTimeout(() => {
      this.failureTimer = null;
      if (this.channelsOpen) return;
      void this.reportStat("failed");
    }, FAILURE_CONFIRM_MS);
  }

  /**
   * One anonymous count per session: did a direct connection work, and over what kind
   * of path. Nothing identifying is sent, and the server keeps only daily totals.
   */
  private async reportStat(outcome: ConnectionOutcome): Promise<void> {
    if (this.statReported) return;
    this.statReported = true;

    let path: ConnectionPath = "unknown";
    if (outcome === "connected") path = (await this.measurePath()) ?? "unknown";
    this.sendStat(outcome, path);
  }

  /**
   * Read which route the connection took. Done the moment the channels open, again once
   * ICE has settled, and after every reconnection, since a restart can move it.
   */
  private async measurePath(): Promise<ConnectionPath | null> {
    const peer = this.peer;
    if (!peer || !this.channelsOpen) return this.path;
    const path = await peer.describePath();
    if (peer !== this.peer || path === "unknown") return this.path;
    if (path !== this.path) {
      this.path = path;
      this.emitNow();
    }
    return path;
  }

  // --- page lifecycle ------------------------------------------------------

  private installLifecycleHandlers(): void {
    if (typeof window === "undefined") return;

    // A bfcache restore resumes a page that was frozen mid-session.
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) this.checkHealth(true);
    });
    window.addEventListener("focus", () => this.checkHealth(true));
    // Reaches every tab at once, so it must not count as this tab being the one in front.
    window.addEventListener("online", () => this.checkHealth(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.checkHealth(true);
    });
    window.addEventListener("pagehide", (event) => {
      this.persist();
      // A device session cannot survive a reload — only a code session's credentials
      // are kept for that — so the other device is told now instead of finding out by
      // waiting. A page only being put into the back/forward cache may yet come back.
      if (!event.persisted) this.hangUp();
    });
  }

  /**
   * Mobile Safari closes the signalling socket and suspends WebRTC when a tab goes to
   * the background, and a bfcache restore does not reliably deliver the close event,
   * so the page can come back believing it is still connected. Probe rather than trust.
   */
  private checkHealth(inFront: boolean): void {
    // The socket that keeps this device reachable by its paired devices, in or out of a session.
    this.group.wake(inFront);

    if (this.phase === "idle" || this.phase === "ended" || this.phase === "creating") return;

    if (this.mode === "code") {
      if (!this.credentials) return;
      // A reconnect is already under way. Starting another closed that one mid-attempt,
      // and its closure then scheduled yet another reconnect, round and round.
      if (this.signaling.isConnecting) return;

      if (!this.signaling.isOpen) {
        this.clearReconnectTimer();
        this.reconnectAttempt = 0;
        this.reconnectDeadline = Date.now() + RESUME_GRACE_MS;
        this.connection = "reconnecting";
        this.emitNow();
        this.resumeSignaling();
        return;
      }
      this.signaling.wake();
    }

    // Only a connection that has actually broken is restarted. Focus comes back for all
    // sorts of reasons — a file or folder picker closing, a click from another window —
    // and restarting ICE on every one threw away attempts that were about to succeed.
    if (this.channelsOpen || !this.peerPresent) return;
    const broken =
      this.connection === "failed" || this.connection === "closed" || this.connection === "reconnecting";
    if (!this.peer || broken) this.revivePeer();
  }

  // --- lifecycle -----------------------------------------------------------

  private end(reason: Message | null): void {
    // Work still in flight for this session, a peer waiting on its servers above all,
    // must not come back to life behind the ended screen.
    this.sessionEpoch += 1;
    this.startingPeer = false;
    this.retryTarget = this.retryFor(reason);
    this.hangUp();
    this.phase = "ended";
    this.error = reason;
    this.peerPresent = false;
    this.channelsOpen = false;
    this.peer?.close();
    this.peer = null;
    this.signaling.close();
    this.transfer.detach();
    this.clearTimers();
    clearSession();
    this.emitNow();
  }

  /**
   * Whether this ending leaves something worth repeating as it was. Only a session that
   * never moved a byte or a line qualifies: anything already handed over would be sent
   * twice, and starting a new session lets go of whatever this one received.
   */
  private retryFor(reason: Message | null): RetryTarget | null {
    if (!reason) return null;
    const moved =
      this.transfer.snapshotOutgoing().length > 0 ||
      this.transfer.snapshotIncoming().length > 0 ||
      this.texts.length > 0;
    if (moved) return null;

    const files = this.pendingFiles;
    const text = this.pendingText;
    if (this.mode === "group") {
      if (!this.peerDevice || !DEVICE_RETRY_REASONS.has(reason.key)) return null;
      return { device: this.peerDevice, files, text };
    }
    // An expired code with nothing staged is just "get a code" again, which the start
    // screen already offers.
    if (reason.key !== "error.nobodyJoined" || (files.length === 0 && text === null)) return null;
    return { device: null, files, text };
  }

  /**
   * Repeat the session that just failed, without anyone picking the files again: call
   * the same device, or reserve a fresh code. A device that is not online cannot be
   * called, so nothing happens until it is; the closing screen says as much.
   */
  retry(): void {
    const target = this.retryTarget;
    if (!target || this.phase !== "ended") return;
    if (target.device) this.connectToDevice(target.device, target.files, target.text);
    else this.host(target.files, target.text);
  }

  reset(): void {
    // Going back to the start mid-session is still leaving it. Without the goodbye the
    // other device spent five minutes waiting for this one to come back, and a code
    // cancelled before anyone joined stayed reserved until it expired.
    if (this.phase !== "idle" && this.phase !== "ended") this.leave();
    this.resetSession();
    this.phase = "idle";
    this.emitNow();
  }

  private resetSession(): void {
    this.sessionEpoch += 1;
    this.hangUp();
    this.clearTimers();
    this.peer?.close();
    this.peer = null;
    this.signaling.close();
    this.transfer.reset();
    clearSession();

    this.role = null;
    this.credentials = null;
    this.remoteInstance = null;
    this.joinExpiresAt = null;
    this.peerPresent = false;
    this.peerAbsentSince = null;
    this.connection = "new";
    this.channelsOpen = false;
    this.openChannels = null;
    this.pendingSignals = [];
    this.peerJoinedAt = null;
    this.mode = "code";
    this.peerDevice = null;
    this.groupCaller = false;
    this.groupAnswered = false;
    this.callAttempts = 0;
    this.handshake = null;
    this.heldControl = [];
    this.verified = false;
    this.pairOffer = null;
    this.peerName = null;
    this.wantPair = false;
    this.texts = [];
    this.pendingFiles = [];
    this.pendingText = null;
    this.retryTarget = null;
    this.notice = null;
    this.error = null;
    this.closedByUser = false;
    this.reconnectAttempt = 0;
    this.reconnectDeadline = null;
    this.statReported = false;
    this.iceServersPromise = null;
    this.resolveIceServers = null;
    this.iceServersFull = null;
    this.relayNeeded = false;
    this.relayDue = false;
    this.path = null;
    this.startingPeer = false;
  }

  private persist(): void {
    if (!this.credentials) return;
    if (this.phase === "idle" || this.phase === "ended") return;
    saveSession({
      code: this.credentials.code,
      sessionKey: this.credentials.sessionKey,
      role: this.credentials.role,
      incoming: this.transfer.persistableIncoming(),
      outgoing: this.transfer.persistableOutgoing(),
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearCallTimer();
    if (this.groupAbsenceTimer) clearTimeout(this.groupAbsenceTimer);
    this.groupAbsenceTimer = null;
    if (this.peerTimer) clearTimeout(this.peerTimer);
    if (this.progressTimer) clearTimeout(this.progressTimer);
    if (this.failureTimer) clearTimeout(this.failureTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.clearEscalateTimer();
    this.settleTimer = null;
    this.peerTimer = null;
    this.progressTimer = null;
    this.failureTimer = null;
  }

  // --- store ---------------------------------------------------------------

  /** Structural changes render immediately. */
  private emitNow(): void {
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }

  /** Byte-level progress fires per frame, so it is coalesced. */
  private emitSoon(): void {
    if (this.progressTimer) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      this.snapshot = this.build();
      for (const listener of this.listeners) listener();
    }, PROGRESS_THROTTLE_MS);
  }

  private build(): Snapshot {
    return {
      phase: this.phase,
      role: this.role,
      code: this.credentials?.code ?? null,
      joinExpiresAt: this.joinExpiresAt,
      shareUrl: this.credentials ? `${location.origin}/?c=${this.credentials.code}` : null,
      peerPresent: this.peerPresent,
      peerAbsentSince: this.peerAbsentSince,
      connection: this.connection,
      relayEngaged: this.relayNeeded,
      path: this.channelsOpen ? this.path : null,
      channelsOpen: this.channelsOpen,
      mode: this.mode,
      identity: this.identity ? { id: this.identity.id, name: this.identity.name } : null,
      devices: this.paired.map((device) => ({
        id: device.id,
        name: device.alias ?? device.name,
        ownName: device.name,
        online: this.presence.has(device.id),
      })),
      groupOnline: this.group.online,
      groupDisplaced: this.group.displaced,
      peerDevice: this.peerDevice,
      verified: this.verified,
      pairing:
        this.mode === "code" && this.pairOffer !== null
          ? { offer: this.pairOffer, name: this.peerName ?? "" }
          : null,
      savingTo: saveDirectoryName(),
      peerJoinedAt: this.peerJoinedAt,
      outgoing: this.transfer.snapshotOutgoing(),
      incoming: this.transfer.snapshotIncoming(),
      texts: this.texts,
      pendingShare:
        this.pendingFiles.length > 0 || this.pendingText
          ? {
              files: this.pendingFiles.length,
              bytes: this.pendingFiles.reduce((sum, file) => sum + file.size, 0),
              text: this.pendingText !== null,
            }
          : null,
      retry: this.retryTarget ? { device: this.retryTarget.device } : null,
      notice: this.notice,
      error: this.error,
    };
  }
}

/** STUN entries only; anything offering a turn: or turns: URL is dropped. */
function withoutRelay(servers: IceServer[]): IceServer[] {
  return servers.filter((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return !urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  });
}

function offersRelay(servers: IceServer[] | null): boolean {
  return servers !== null && withoutRelay(servers).length < servers.length;
}

/** Debug switch: ?relay=force proves the relay path works on a given network. */
function isRelayForced(): boolean {
  try {
    return new URLSearchParams(location.search).get("relay") === "force";
  } catch {
    return false;
  }
}

/**
 * Text as it is sent: blank lines and spaces at either end go, but the line breaks
 * inside and the first line's indent stay, so pasted code keeps its shape. Null when
 * nothing is left.
 */
function tidyText(body: string | null): string | null {
  return body?.replace(/^\s*\n/, "").trimEnd() || null;
}

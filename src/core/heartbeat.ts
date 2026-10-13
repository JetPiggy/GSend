/**
 * Keeps a signalling socket honest about whether it is still connected.
 *
 * A socket whose network went away — a phone moving from Wi-Fi to mobile data, a laptop
 * waking from sleep, a tab Safari froze in the background — can sit in OPEN for minutes
 * with no close event ever arriving. Nothing reconnects it, every message sent into it
 * is lost, and the device keeps showing as online on the other screens. A probe that
 * goes unanswered is the only reliable sign, so this sends one on a timer and again
 * whenever the page comes back to the foreground.
 */
import { HEARTBEAT_PING, HEARTBEAT_PONG } from "../../shared/protocol";

/** Well inside the minute that a backgrounded tab's timers may be throttled to. */
const INTERVAL_MS = 20_000;
/** How long a probe may go unanswered before the socket is written off. */
const TIMEOUT_MS = 8_000;
/** After a wake-up the socket is suspect, so it gets less benefit of the doubt. */
const WAKE_TIMEOUT_MS = 4_000;

export class Heartbeat {
  private socket: WebSocket | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  /**
   * A server running an older build never answers. Only a socket that has answered at
   * least once can be judged by its silence, or every one of those would look dead.
   */
  private answered = false;

  constructor(private readonly onDead: (socket: WebSocket) => void) {}

  watch(socket: WebSocket): void {
    this.stop();
    this.socket = socket;
    this.answered = false;
    this.interval = setInterval(() => this.probe(TIMEOUT_MS), INTERVAL_MS);
    // Learn straight away whether this server answers at all.
    this.probe(TIMEOUT_MS);
  }

  /** Returns true when the frame was a heartbeat reply, which the caller should then ignore. */
  handle(data: unknown): boolean {
    if (data !== HEARTBEAT_PONG) return false;
    this.answered = true;
    this.clearDeadline();
    return true;
  }

  /** Probe now, for a page that has just returned from the background or the network. */
  wake(): void {
    this.probe(WAKE_TIMEOUT_MS);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.clearDeadline();
    this.socket = null;
  }

  private probe(timeoutMs: number): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(HEARTBEAT_PING);
    } catch {
      return;
    }
    if (!this.answered || this.deadline) return;
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (this.socket === socket) this.onDead(socket);
    }, timeoutMs);
  }

  private clearDeadline(): void {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }
}

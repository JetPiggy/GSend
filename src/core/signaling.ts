import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import { Heartbeat } from "./heartbeat";

export interface SignalingHandlers {
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  onClose(code: number): void;
}

/** What a socket that stopped answering is reported as: a drop, not a refusal. */
const ABNORMAL_CLOSURE = 1006;

/** Thin typed wrapper over the WebSocket to the Worker. Reconnection lives in the client. */
export class Signaling {
  private socket: WebSocket | null = null;
  private readonly heartbeat = new Heartbeat((socket) => this.dropDead(socket));

  constructor(private readonly handlers: SignalingHandlers) {}

  connect(params: Record<string, string>): void {
    this.close();

    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams(params).toString();
    const socket = new WebSocket(`${scheme}//${location.host}/api/ws?${query}`);
    this.socket = socket;

    // Every handler checks that its socket is still the current one. A replaced socket
    // goes on to close in its own time, and its closure used to be reported as a drop of
    // the new one: the client reconnected, which replaced the socket again, whose
    // closure was reported again — a loop that swapped the socket every second and
    // knocked the peer connection back each time it was nearly up.
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.heartbeat.watch(socket);
      this.handlers.onOpen();
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      if (this.heartbeat.handle(event.data)) return;
      if (typeof event.data !== "string") return;
      try {
        this.handlers.onMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.heartbeat.stop();
      this.handlers.onClose(event.code);
    });
    socket.addEventListener("error", () => {
      /* the close handler runs next and carries the outcome */
    });
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** A connection attempt is already under way; starting another would only replace it. */
  get isConnecting(): boolean {
    return this.socket?.readyState === WebSocket.CONNECTING;
  }

  /** The page is back from the background: find out now whether the socket survived. */
  wake(): void {
    this.heartbeat.wake();
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.heartbeat.stop();
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "client closed");
  }

  /**
   * A socket that stopped answering is let go at once rather than closed politely: the
   * closing handshake cannot complete over a dead network, and waiting for it to time
   * out would hold the reconnect back by up to a minute.
   */
  private dropDead(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.heartbeat.stop();
    try {
      socket.close();
    } catch {
      /* already gone */
    }
    this.handlers.onClose(ABNORMAL_CLOSURE);
  }
}

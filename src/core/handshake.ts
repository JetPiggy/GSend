/**
 * The mutual proof two devices exchange as soon as their control channel opens, and the
 * pairing that may follow it.
 *
 * Both sides send a claim and a nonce, then each signs the other's nonce with the
 * private key behind its claim. Nothing here is secret — the channel is already
 * DTLS-encrypted — the point is that a device cannot assert an identity it does not
 * hold the key for.
 *
 * What that proof is worth depends on how the two met:
 *
 * - Through a 4-digit code, the code itself is the security, and the proof only makes a
 *   pairing possible. It is therefore advisory: a peer that never answers simply cannot
 *   be remembered, and the transfer proceeds regardless. That keeps a tab running an
 *   older build working. Proving who the other device is does not pair the two either:
 *   that waits until the people on both sides have asked for it, so sending one file to
 *   someone by code does not put them in your device list for good.
 * - Through the rendezvous room, nobody typed anything, so the proof is the only thing
 *   standing between a stranger who somehow reached the room and the person's files.
 *   There it is mandatory, checked against the public key stored at pairing time, and
 *   nothing moves until it passes.
 */
import { AUTH_LABEL, type PeerControl } from "./protocol";
import { adoptGroup, createGroup, knownDevices, rememberDevice, type KnownDevice } from "./devices";
import { fromBase64url, signBytes, toBase64url, toHex, verifyBytes, type Identity } from "./identity";

export type HandshakeMode = "code" | "group";

export type RejectReason = "unknown-device" | "bad-proof" | "rejected-by-peer";

/**
 * How far a code session has got towards the two devices remembering each other.
 * "asked": the other side has asked and this one has not. "waiting": this side has, and
 * is waiting for the other to ask too or for its group to arrive.
 */
export type PairOffer = "open" | "asked" | "waiting" | "paired";

export interface HandshakeHandlers {
  send(msg: PeerControl): void;
  /** The peer proved it holds the key behind the device it claims to be. */
  onVerified(device: KnownDevice): void;
  /** A code session's offer to pair moved on. Never called in group mode. */
  onPairing(offer: PairOffer): void;
  /**
   * The pairing is written down on this side. `stranded` counts devices left behind in
   * a group this one gave up, zero in the ordinary case.
   */
  onPaired(stranded: number): void;
  onRejected(reason: RejectReason): void;
}

interface Claim {
  id: string;
  name: string;
  publicKey: string;
  devices: number;
  /** The peer pairs only when asked to. Older builds pair on their own. */
  consent: boolean;
}

/** Whether a control message belongs to the handshake rather than to the transfer engine. */
export function isHandshakeMessage(msg: PeerControl): boolean {
  return (
    msg.t === "auth" ||
    msg.t === "auth-proof" ||
    msg.t === "group-invite" ||
    msg.t === "auth-fail" ||
    msg.t === "pair"
  );
}

/** The id is a hash of the public key, so a claim can be checked against itself. */
async function idMatchesKey(id: string, publicKey: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      fromBase64url(publicKey) as unknown as BufferSource,
    );
    return toHex(digest.slice(0, 8)) === id;
  } catch {
    return false;
  }
}

function proofBytes(signer: string, recipient: string, nonce: string): Uint8Array {
  return new TextEncoder().encode(`${AUTH_LABEL}${signer}>${recipient}:${nonce}`);
}

function toDevice(claim: Claim): KnownDevice {
  return { id: claim.id, name: claim.name, publicKey: claim.publicKey, addedAt: Date.now() };
}

export class Handshake {
  private readonly nonce: string;
  private claim: Claim | null = null;
  /** True once the peer's signature over our nonce has checked out. */
  private proved = false;
  /** True once we have answered their nonce, so they can prove us in turn. */
  private answered = false;
  private settled = false;
  /** Settled by the proof going through, rather than by a refusal. */
  private verified = false;
  /**
   * The group size this side announced. Which side hands over its group is decided from
   * the two announced sizes, so both sides reach the same answer however their lists
   * change in the meantime.
   */
  private announced = 0;
  /** The person on this side asked to remember the peer. */
  private wantsPair = false;
  /** The person on the other side asked to remember this device. */
  private peerWantsPair = false;
  private paired = false;
  /** This side handed over its group, so an invitation crossing it is not taken. */
  private invited = false;
  /**
   * A group the peer offered before this side agreed to anything. An older build sends
   * one unasked the moment the proof is through; it is kept, and only acted on if the
   * person here asks to pair.
   */
  private heldInvite: string | null = null;
  /**
   * Each step awaits crypto, and the peer's next message can land before the last one
   * is through: a proof arriving mid-claim found no claim to check and was dropped, so
   * the slower device never recorded the pairing while the other did. The channel is
   * ordered, so running each message only after the previous one keeps them in order.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly identity: Identity,
    private readonly mode: HandshakeMode,
    private readonly handlers: HandshakeHandlers,
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    this.nonce = toBase64url(bytes);
  }

  async begin(): Promise<void> {
    this.announced = (await knownDevices()).length;
    this.handlers.send({
      t: "auth",
      id: this.identity.id,
      name: this.identity.name,
      publicKey: this.identity.publicKey,
      nonce: this.nonce,
      devices: this.announced,
      consent: true,
    });
  }

  /** Returns true when the message belonged to the handshake and was consumed. */
  handle(msg: PeerControl): boolean {
    switch (msg.t) {
      case "auth":
        this.enqueue(() => this.onClaim(msg));
        return true;
      case "auth-proof":
        this.enqueue(() => this.onProof(msg.sig));
        return true;
      case "pair":
        this.enqueue(() => this.onPeerConsent());
        return true;
      case "group-invite":
        this.enqueue(() => this.onInvite(msg.secret));
        return true;
      case "auth-fail":
        this.enqueue(async () => this.reject("rejected-by-peer"));
        return true;
      default:
        return false;
    }
  }

  /**
   * The person here asked to remember the other device of a code session. It cannot be
   * withdrawn: a yes taken back while the other side's was on its way would leave one
   * device paired and the other not. "Unpair" undoes it afterwards.
   */
  consent(): void {
    this.enqueue(() => this.onOwnConsent());
  }

  private enqueue(step: () => Promise<void>): void {
    this.queue = this.queue.then(step).catch(() => undefined);
  }

  private async onClaim(msg: Extract<PeerControl, { t: "auth" }>): Promise<void> {
    if (this.claim || this.settled) return;
    if (typeof msg.id !== "string" || typeof msg.publicKey !== "string") return;

    // A device that names itself something other than its own key's hash is either
    // broken or trying to borrow another device's slot in the list.
    if (!(await idMatchesKey(msg.id, msg.publicKey))) {
      this.reject("bad-proof");
      return;
    }

    if (this.mode === "group") {
      const known = (await knownDevices()).find((device) => device.id === msg.id);
      if (!known || known.publicKey !== msg.publicKey) {
        this.reject("unknown-device");
        return;
      }
    }

    this.claim = {
      id: msg.id,
      name: typeof msg.name === "string" && msg.name ? msg.name.slice(0, 40) : msg.id,
      publicKey: msg.publicKey,
      devices: Number.isFinite(msg.devices) ? msg.devices : 0,
      consent: msg.consent === true,
    };

    const sig = await signBytes(
      this.identity,
      proofBytes(this.identity.id, msg.id, msg.nonce),
    );
    this.answered = true;
    this.handlers.send({ t: "auth-proof", sig });
    await this.maybeSettle();
  }

  private async onProof(sig: string): Promise<void> {
    const claim = this.claim;
    if (!claim || this.proved || this.settled) return;

    const ok = await verifyBytes(
      claim.publicKey,
      sig,
      proofBytes(claim.id, this.identity.id, this.nonce),
    );
    if (!ok) {
      this.reject("bad-proof");
      return;
    }

    this.proved = true;
    await this.maybeSettle();
  }

  private async maybeSettle(): Promise<void> {
    if (this.settled || !this.proved || !this.answered || !this.claim) return;
    this.settled = true;
    this.verified = true;

    const device = toDevice(this.claim);
    // Two paired devices meeting again: keep the name the other one goes by now.
    if (this.mode === "group") await rememberDevice(device);

    this.handlers.onVerified(device);
    if (this.mode === "code") this.handlers.onPairing(this.offer());
  }

  private async onOwnConsent(): Promise<void> {
    if (this.mode !== "code" || !this.verified || this.wantsPair) return;
    this.wantsPair = true;
    // An older build would hand this to its transfer engine, which has no use for it.
    if (this.claim?.consent) this.handlers.send({ t: "pair" });
    this.handlers.onPairing(this.offer());
    await this.maybePair();
  }

  private async onPeerConsent(): Promise<void> {
    if (this.mode !== "code" || this.peerWantsPair) return;
    this.peerWantsPair = true;
    // Reported once the proof is through, which is when there is anything to show.
    if (!this.verified) return;
    this.handlers.onPairing(this.offer());
    await this.maybePair();
  }

  private async onInvite(secret: string): Promise<void> {
    if (this.mode !== "code" || this.paired || this.invited) return;
    if (typeof secret !== "string" || !secret) return;
    // Only a peer that has proved itself gets to move this device into another group.
    if (!this.verified) return;
    this.heldInvite = secret;
    await this.maybePair();
  }

  private offer(): PairOffer {
    if (this.paired) return "paired";
    if (this.wantsPair) return "waiting";
    return this.peerWantsPair ? "asked" : "open";
  }

  /**
   * Pair once both people have asked to. A peer on an older build never asks: it
   * remembered this device on its own the moment the proof went through, so the yes on
   * this side is the only one still missing.
   */
  private async maybePair(): Promise<void> {
    const claim = this.claim;
    if (this.paired || !this.verified || !claim || !this.wantsPair) return;
    if (claim.consent && !this.peerWantsPair) return;

    // A group already offered is taken as it is. An older build decides for itself
    // whether it is the one to hand its group over, and sends it without waiting.
    if (this.heldInvite) {
      const stranded = await adoptGroup(this.heldInvite, claim.id);
      await this.record(claim, stranded);
      return;
    }

    // Only one side hands over its group, or the two would swap and neither would
    // keep any pairings. The larger group wins because it has more to lose; equal
    // sizes are broken by id, which both sides can evaluate identically.
    const iInvite =
      this.announced > claim.devices ||
      (this.announced === claim.devices && this.identity.id < claim.id);
    // Otherwise the other side's group is on its way, and onInvite finishes this.
    if (!iInvite) return;

    this.invited = true;
    this.handlers.send({ t: "group-invite", secret: await createGroup() });
    await this.record(claim, 0);
  }

  private async record(claim: Claim, stranded: number): Promise<void> {
    // After any adoption, whose merged list may not carry the peer yet.
    await rememberDevice(toDevice(claim));
    this.paired = true;
    this.handlers.onPaired(stranded);
  }

  private reject(reason: RejectReason): void {
    if (this.settled) return;
    this.settled = true;
    // Tell them before hanging up, so the refusal reads as a refusal on both screens.
    if (reason !== "rejected-by-peer") this.handlers.send({ t: "auth-fail" });
    this.handlers.onRejected(reason);
  }
}

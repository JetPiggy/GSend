import type { GSendClient, Snapshot } from "../core/client";
import { directPickerSupported } from "../core/sink";
import { useI18n } from "../i18n";

interface Props {
  client: GSendClient;
  state: Snapshot;
}

export default function PairingPanel({ client, state }: Props) {
  const { t, tm } = useI18n();

  // An open data channel outranks a stale departure notice from signalling.
  const waitingForPeer = state.peerAbsentSince !== null && !state.channelsOpen;

  const title = waitingForPeer
    ? t("pairing.waitingTitle")
    : state.channelsOpen
      ? t("pairing.almostThere")
      : t("pairing.connecting");

  // A device session has a name to put on the wait, and a verification step the person
  // should be told about rather than left guessing at.
  const peer = state.devices.find((device) => device.id === state.peerDevice);
  const message = waitingForPeer
    ? t("pairing.waitingBody")
    : peer
      ? state.channelsOpen
        ? t("devices.verifying", { name: peer.name })
        : t("devices.connecting", { name: peer.name })
      : t("pairing.connectingBody");

  /*
    Joining never stops to ask for a folder, so this is where the choice is offered.
    Connecting takes a moment either way, and the offer fills it — take it and files
    stream to disk, skip it and they land in browser storage instead.
  */
  const offerFolder = directPickerSupported() && state.savingTo === null;
  const failed = state.connection === "failed";

  return (
    <section className="waiting">
      <img
        className={failed ? "waiting__pig waiting__pig--still brand-only" : "waiting__pig brand-only"}
        src={failed ? "/img/crash.webp" : "/img/fly.webp"}
        alt=""
        width={failed ? 640 : 760}
        height={failed ? 384 : 414}
      />
      <div className="sheet" aria-live="polite">
        <h2>
          {title}
          {!failed && (
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </h2>
        <p>{message}</p>
        {offerFolder && (
          <div>
            <button type="button" className="btn" onClick={() => void client.chooseFolder()}>
              {t("transfer.chooseFolder")}
            </button>
          </div>
        )}
        <dl className="facts">
          {state.code && (
            <>
              <dt>{t("pairing.code")}</dt>
              <dd>{state.code}</dd>
            </>
          )}
          {peer && (
            <>
              <dt>{t("transfer.paired")}</dt>
              <dd>{peer.name}</dd>
            </>
          )}
          <dt>{t("pairing.relay")}</dt>
          <dd>{state.relayEngaged ? t("pairing.relayEngaged") : t("pairing.relayStandby")}</dd>
        </dl>
        {state.notice && (
          <p className="alert alert--soft" onClick={() => client.dismissNotice()}>
            {tm(state.notice)}
          </p>
        )}
        {failed && <p className="alert">{t("pairing.noDirectRoute")}</p>}
      </div>
    </section>
  );
}

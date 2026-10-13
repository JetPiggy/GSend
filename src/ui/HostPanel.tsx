import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { GSendClient, Snapshot } from "../core/client";
import { formatBytes } from "../core/sink";
import { useI18n } from "../i18n";
import CodeBoxes from "./CodeBoxes";
import { HandNote, Stamps } from "./hand";
import { useWork, withWork } from "./work";

interface Props {
  client: GSendClient;
  state: Snapshot;
}

/** The code is joinable for this long; the countdown bar drains against it. */
const JOIN_WINDOW_S = 60;

/**
 * The same four boxes as the home screen, now holding this session's code, so the
 * digits land where the person was just looking. The QR code and link sit in the strip
 * where the send controls were.
 */
export default function HostPanel({ client, state }: Props) {
  const { t } = useI18n();
  const work = useWork();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const remaining = useCountdown(state.joinExpiresAt);
  const creating = state.phase === "creating";
  const link = state.shareUrl ? withWork(state.shareUrl, work) : null;

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
    };
  }, [link]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is on screen anyway */
    }
  };

  const queued = !state.pendingShare
    ? t("host.queuedNothing")
    : state.pendingShare.files > 0
      ? t("host.queuedFiles", { count: state.pendingShare.files, size: formatBytes(state.pendingShare.bytes) })
      : t("host.queuedText");

  return (
    <section className="home">
      <div className="home__ask">
        <h1 className="ask">
          {t("host.title", { host: location.host })}
          <span className="ask__sub">{t("host.subtitle")}</span>
        </h1>
        <HandNote />
      </div>

      <CodeBoxes
        value={state.code ?? ""}
        pending={creating}
        stagger
        label={creating ? t("host.creating") : t("host.codeLabel", { code: state.code ?? "" })}
      />

      <div className="home__under">
        {creating ? <p>{t("host.creating")}</p> : <Countdown remaining={remaining} />}
        <Stamps />
      </div>

      <section className="strip strip--host" aria-label={t("host.subtitle")}>
        <div className="qr-plate">
          {qr ? (
            <img className="qr" src={qr} alt={t("host.qrAlt")} width={148} height={148} />
          ) : (
            <span className="qr" aria-hidden="true" />
          )}
        </div>

        <div className="host__info">
          <p className="host__queued">{queued}</p>
          {link && (
            <button type="button" className="link-copy" onClick={copy}>
              <span className="link-copy__url">{link.replace(/^https?:\/\//, "")}</span>
              <span className="link-copy__hint" aria-live="polite">
                {copied ? t("host.linkCopied") : t("host.copy")}
              </span>
            </button>
          )}
          <p className="host__burn">{t("host.burnNote")}</p>
        </div>

        <button type="button" className="btn btn--ghost" onClick={() => client.reset()}>
          {t("host.cancel")}
        </button>
      </section>
    </section>
  );
}

function Countdown({ remaining }: { remaining: number }) {
  const { t } = useI18n();
  const share = Math.max(0, Math.min(100, (remaining / JOIN_WINDOW_S) * 100));
  return (
    <div className={remaining <= 10 ? "countdown countdown--urgent" : "countdown"}>
      <div className="countdown__track" aria-hidden="true">
        <div className="countdown__fill" style={{ width: `${share}%` }} />
      </div>
      <span className="countdown__text">
        {remaining > 0 ? t("host.expiresIn", { seconds: remaining }) : t("host.expired")}
      </span>
    </div>
  );
}

function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [deadline]);

  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

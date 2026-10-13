import { useEffect, useState, useSyncExternalStore } from "react";
import { GSendClient, type Snapshot } from "./core/client";
import { collectShare } from "./core/share";
import { directPickerSupported, formatBytes, maxFileBytes, prepareStorage } from "./core/sink";
import { useI18n, type MessageKey, type Translator } from "./i18n";
import { useDropGuard } from "./ui/drop";
import Landing from "./ui/Landing";
import HostPanel from "./ui/HostPanel";
import PairingPanel from "./ui/PairingPanel";
import TransferPanel, { TransferRow } from "./ui/TransferPanel";
import { setWork, useWork } from "./ui/work";

const client = new GSendClient();

/** Module scope so React StrictMode's double mount cannot join twice. */
let autoJoinHandled = false;

function readCodeFromUrl(): string {
  const code = new URLSearchParams(location.search).get("c") ?? "";
  return /^\d{4}$/.test(code) ? code : "";
}

export default function App() {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const i18n = useI18n();
  const { t, toggle } = i18n;
  const work = useWork();
  // The code being typed lives here, not on the home screen: a join that fails comes
  // back to a freshly mounted home screen, which should still show the digits tried.
  const [code, setCode] = useState("");
  const [limit, setLimit] = useState(() => maxFileBytes());

  useDropGuard();

  useEffect(() => {
    // Settle the storage probe here rather than on the landing screen, which never
    // renders when someone arrives by QR code or link, and go online for the paired
    // devices. Both guard themselves, so neither belongs behind the auto-join latch.
    // The per-file ceiling depends on whether this browser will actually give us disk.
    void prepareStorage().then(() => setLimit(maxFileBytes()));
    void client.wake();

    if (autoJoinHandled) return;
    autoJoinHandled = true;

    // Arriving from the system share sheet outranks everything: the person picked this
    // app in order to send something specific.
    if (new URLSearchParams(location.search).has("shared")) {
      history.replaceState(null, "", location.pathname);
      void collectShare().then((payload) => {
        if (payload) client.stageShared(payload.files, payload.text);
      });
      return;
    }

    // A fresh code in the URL is an explicit request to join, so it outranks whatever
    // session this tab was in before.
    const linked = readCodeFromUrl();
    if (linked) {
      setCode(linked);
      history.replaceState(null, "", location.pathname);
      client.join(linked);
      return;
    }

    client.restore();
  }, []);

  // Once a join gets through, or this device starts a session of its own, the digits
  // have done their job.
  useEffect(() => {
    if (state.phase !== "idle" && state.phase !== "joining") setCode("");
  }, [state.phase]);

  const pairing = state.phase === "joining" || state.phase === "pairing";
  const inSession = state.phase !== "idle" && state.phase !== "ended";
  // A restored or reconnecting session is still "pairing" while it re-attaches, and it
  // may already be holding files. Anything with contents shows the list, not the wait.
  const hasContents = state.incoming.length > 0 || state.outgoing.length > 0 || state.texts.length > 0;
  const showTransfers = state.phase === "active" || (pairing && hasContents);

  // Two sentences rather than one interpolation: "up to your free disk per file" is not
  // a sentence, and the two cases are genuinely different claims.
  const limitLine = directPickerSupported()
    ? t("landing.limitDisk")
    : t("landing.limitSize", { size: formatBytes(limit) });

  return (
    <div className="app">
      <header className="app__header">
        <button type="button" className="brand" onClick={() => client.reset()} aria-label={t("app.back")}>
          <img className="brand__face brand-only" src="/img/face-nav.png" alt="" width={44} height={44} />
          <span className="brand__name">GSend</span>
        </button>
        <a className="by" href="https://jetpiggy.com" target="_blank" rel="noopener">
          {t("app.by")}
        </a>
        <span className="header__spacer" />
        {inSession && state.channelsOpen && <StatusChip state={state} i18n={i18n} />}
        <div className="header__tools">
          <button
            type="button"
            role="switch"
            aria-checked={work}
            className="switch"
            title={t("app.workHint")}
            onClick={() => setWork(!work)}
          >
            <span className="switch__track" aria-hidden="true">
              <span className="switch__knob" />
            </span>
            <span className="switch__long">{t("app.work")}</span>
            <span className="switch__short">{t("app.workShort")}</span>
          </button>
          <button type="button" className="lang" onClick={toggle} title={t("app.language")} lang={i18n.language === "en" ? "zh-Hant-HK" : "en"}>
            {t("app.languageShort")}
          </button>
          {inSession && (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => client.leave()}>
              {t("app.endSession")}
            </button>
          )}
        </div>
      </header>

      <main className="app__main">
        {state.phase === "idle" && <Landing client={client} state={state} code={code} onCode={setCode} limitLine={limitLine} />}
        {(state.phase === "creating" || state.phase === "hosting") && <HostPanel client={client} state={state} />}
        {pairing && !showTransfers && <PairingPanel client={client} state={state} />}
        {/*
          The panel stays up even while the connection is degraded. A received file on
          the browser-storage path lives in this list until it is saved, so hiding it on
          a dropped connection loses the file.
        */}
        {showTransfers && <TransferPanel client={client} state={state} />}
        {state.phase === "ended" && <EndedScreen state={state} i18n={i18n} />}
      </main>

      <footer className="app__footer">
        <span>{t("app.footer")}</span>
        {state.phase === "idle" && <span>{limitLine}</span>}
        <a href="/privacy">{t("app.privacy")}</a>
      </footer>
    </div>
  );
}

/** "Connected · direct" in the header: the route the bytes actually take, as measured. */
function StatusChip({ state, i18n }: { state: Snapshot; i18n: Translator }) {
  const online = state.connection === "connected" && state.channelsOpen;
  const label = online
    ? state.path === "relay"
      ? i18n.t("status.relayed")
      : state.path === "lan" || state.path === "internet"
        ? i18n.t("status.direct")
        : i18n.t("status.connected")
    : state.peerAbsentSince !== null && !state.channelsOpen
      ? i18n.t("status.peerAway")
      : state.connection === "reconnecting"
        ? i18n.t("status.reconnecting")
        : state.connection === "failed"
          ? i18n.t("status.lost")
          : i18n.t("status.connecting");

  return (
    <span className={online ? "status" : "status status--warn"} role="status">
      <span className="status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Endings that were nobody's choice, where the pig has crashed rather than landed. */
const MISHAPS: ReadonlySet<MessageKey> = new Set([
  "error.nobodyJoined",
  "error.deviceUnreachable",
  "error.deviceBusy",
  "error.unknownDevice",
  "error.expiredWhileAway",
  "error.serverLost",
  "error.peerGone",
  "server.code_not_found",
  "server.code_expired",
  "server.session_full",
  "server.bad_key",
  "server.rate_limited",
  "server.no_capacity",
  "server.bad_request",
]);

function EndedScreen({ state, i18n }: { state: Snapshot; i18n: Translator }) {
  const { t, tm } = i18n;

  const sent = state.outgoing.filter((row) => row.status === "done");
  const received = state.incoming.filter((row) => row.status === "done");
  const sentBytes = sent.reduce((sum, row) => sum + row.size, 0);
  const receivedBytes = received.reduce((sum, row) => sum + row.size, 0);
  const hasSummary = sent.length > 0 || received.length > 0;
  // Files held in browser storage exist only as these links. The sender ending the
  // session as soon as its files are through is the usual way a session ends, and this
  // screen used to replace the list with a summary, leaving them no way to be saved.
  const held = received.filter((row) => row.downloadUrl && !row.savedAs);
  const unsaved = held.filter((row) => !row.downloaded).length;
  // Trying again keeps what was picked, so nobody has to choose it again. A device can
  // only be called while it is online; the button waits for it rather than doing nothing.
  const retry = state.retry;
  const retryDevice = retry?.device ? state.devices.find((device) => device.id === retry.device) : null;
  const showRetry = retry !== null && (retry.device === null || retryDevice != null);
  const retryWaiting = retryDevice != null && !retryDevice.online;
  const queued = state.pendingShare;
  const mishap = !hasSummary && state.error !== null && MISHAPS.has(state.error.key);

  return (
    <section className="ended">
      <img
        className={mishap ? "ended__pig ended__pig--crash brand-only" : "ended__pig brand-only"}
        src={mishap ? "/img/crash.webp" : "/img/face-smile.webp"}
        alt=""
        width={mishap ? 640 : 240}
        height={mishap ? 384 : 240}
      />
      <div className="sheet">
        <h2>{t("ended.title")}</h2>
        <p className="ended__lede">{tm(state.error) ?? t("ended.default")}</p>
        {state.pairing?.offer === "paired" && (
          <p className="ended__lede">{t("remember.paired", { name: state.pairing.name })}</p>
        )}
        {(hasSummary || (showRetry && queued)) && (
          <dl className="facts">
            {sent.length > 0 && (
              <>
                <dt>{t("ended.sent")}</dt>
                <dd>{t("ended.count", { count: sent.length, size: formatBytes(sentBytes) })}</dd>
              </>
            )}
            {received.length > 0 && (
              <>
                <dt>{t("ended.received")}</dt>
                <dd>{t("ended.count", { count: received.length, size: formatBytes(receivedBytes) })}</dd>
              </>
            )}
            {showRetry && queued && (
              <>
                <dt>{t("ended.queued")}</dt>
                <dd>
                  {[
                    queued.files > 0 ? t("ended.count", { count: queued.files, size: formatBytes(queued.bytes) }) : null,
                    queued.text ? t("ended.text") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </>
            )}
          </dl>
        )}
        {held.length > 0 && (
          <div className="ended__held">
            {unsaved > 0 && <p className="ended__lede">{t("ended.unsaved")}</p>}
            {state.notice && (
              <p className="alert alert--soft" onClick={() => client.dismissNotice()}>
                {tm(state.notice)}
              </p>
            )}
            <ul className="transfers">
              {held.map((transfer) => (
                <TransferRow key={transfer.id} transfer={transfer} client={client} i18n={i18n} />
              ))}
            </ul>
            {unsaved > 1 && (
              <div>
                <button type="button" className="btn btn--ghost" onClick={() => void client.saveAll()}>
                  {t("transfer.saveAll")} · {unsaved}
                </button>
              </div>
            )}
          </div>
        )}
        {retryWaiting && <p className="ended__lede">{t("ended.retryOffline", { name: retryDevice.name })}</p>}
        <div className="ended__actions">
          {showRetry && (
            <button type="button" className="btn" disabled={retryWaiting} onClick={() => client.retry()}>
              {t("ended.retry")}
            </button>
          )}
          <button type="button" className={showRetry ? "btn btn--ghost" : "btn"} onClick={() => client.reset()}>
            {t("ended.startOver")}
          </button>
        </div>
      </div>
    </section>
  );
}

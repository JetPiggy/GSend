import { useRef, useState } from "react";
import type { ConnectionPath } from "../../shared/protocol";
import type { GSendClient, Snapshot } from "../core/client";
import { directPickerSupported, formatBytes, maxFileBytes } from "../core/sink";
import type { TransferView } from "../core/transfer";
import { useI18n, type MessageKey, type Translator } from "../i18n";
import { DropOverlay, useWindowDrop } from "./drop";

interface Props {
  client: GSendClient;
  state: Snapshot;
}

export default function TransferPanel({ client, state }: Props) {
  const i18n = useI18n();
  const { t, tm } = i18n;
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [joinDismissed, setJoinDismissed] = useState(false);

  const transfers = [...state.outgoing, ...state.incoming].sort((a, b) => b.startedAt - a.startedAt);

  const upBytes = state.outgoing.reduce((sum, row) => sum + row.transferred, 0);
  const downBytes = state.incoming.reduce((sum, row) => sum + row.transferred, 0);
  const itemCount = transfers.length + state.texts.length;
  // One file has its own button right there; the shortcut earns its place from two up.
  const unsaved = state.incoming.filter((row) => row.status === "done" && row.downloadUrl && !row.downloaded).length;

  const send = (list: Iterable<File> | null) => {
    if (!list) return;
    const picked = [...list];
    if (picked.length > 0) client.sendFiles(picked);
    if (fileInput.current) fileInput.current.value = "";
  };

  const dragging = useWindowDrop(send);

  const submitText = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    client.sendText(draft);
    setDraft("");
  };

  return (
    <section className="session">
      {dragging && <DropOverlay label={t("transfer.dropRelease")} />}

      <div className="session__main">
        <div className="session-head">
          <h2>{t("transfer.session")}</h2>
          <span className="session-head__meta">
            {t("transfer.sessionMeta", { count: itemCount, up: formatBytes(upBytes), down: formatBytes(downBytes) })}
          </span>
          {unsaved > 1 && (
            <button type="button" className="btn btn--small" onClick={() => void client.saveAll()}>
              {t("transfer.saveAll")} · {unsaved}
            </button>
          )}
        </div>

        {/*
          What replaced the approval screen: the sender is told the instant a device is
          through, with the kill switch in the same breath rather than a step earlier.
        */}
        {state.mode === "code" && state.role === "host" && state.channelsOpen && !joinDismissed && (
          <div className="alert alert__row" role="status">
            <span>{t("transfer.peerJoined")}</span>
            <button type="button" className="btn btn--danger btn--small" onClick={() => client.leave()}>
              {t("transfer.stop")}
            </button>
            <button type="button" className="btn btn--text" onClick={() => setJoinDismissed(true)}>
              {t("transfer.dismiss")}
            </button>
          </div>
        )}

        {state.notice && (
          <p className="alert alert--soft" onClick={() => client.dismissNotice()}>
            {tm(state.notice)}
          </p>
        )}

        {/*
          Remembering is offered, never assumed: sending someone one file by code should
          not put them in this device list for good. Both people have to ask.
        */}
        {state.pairing && (
          <div className="sheet remember">
            <p>{t(`remember.${state.pairing.offer}`, { name: state.pairing.name })}</p>
            {(state.pairing.offer === "open" || state.pairing.offer === "asked") && (
              <button
                type="button"
                className={state.pairing.offer === "asked" ? "btn btn--small" : "btn btn--ghost btn--small"}
                onClick={() => client.rememberPeer()}
              >
                {t(state.pairing.offer === "asked" ? "remember.agree" : "remember.ask")}
              </button>
            )}
          </div>
        )}

        {itemCount === 0 && <p className="empty">{t("transfer.empty")}</p>}

        {transfers.length > 0 && (
          <ul className="transfers">
            {transfers.map((transfer) => (
              <TransferRow key={transfer.id} transfer={transfer} client={client} i18n={i18n} />
            ))}
          </ul>
        )}

        {state.texts.length > 0 && (
          <ul className="messages">
            {state.texts
              .slice()
              .reverse()
              .map((message) => (
                <li key={message.id} className={message.mine ? "message message--mine" : "message"}>
                  <span className="message__body">{message.body}</span>
                  <CopyButton text={message.body} i18n={i18n} />
                </li>
              ))}
          </ul>
        )}
      </div>

      <aside className="session__aside">
        <div className="dropzone">
          <svg className="arrow-up" viewBox="0 0 30 36" aria-hidden="true">
            <path
              d="M15 33 C14 24 16 14 15 4 M5 13 C9 10 12 7 15 3 C18 7 21 10 25 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p>{t("landing.dropAnywhere")}</p>
          <button type="button" className="btn btn--ghost" onClick={() => fileInput.current?.click()}>
            {t("transfer.chooseFiles")}
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => send(event.target.files)} />
        </div>

        <form className="composer" onSubmit={submitText}>
          <input
            className="field"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("transfer.textPlaceholder")}
            aria-label={t("transfer.textLabel")}
          />
          <button type="submit" className="btn" disabled={!draft.trim()}>
            {t("transfer.send")}
          </button>
        </form>

        {!state.savingTo && directPickerSupported() && (
          <button type="button" className="btn btn--ghost" onClick={() => void client.chooseFolder()}>
            {t("transfer.chooseFolder")}
          </button>
        )}

        <SessionFacts state={state} i18n={i18n} />
        {/* A slow transfer through the relay looks like the app being slow; say why. */}
        {state.path === "relay" && <p className="aside-note">{t("transfer.relayNote")}</p>}
        <p className="aside-note">
          {state.savingTo ? t("transfer.saveFolder", { folder: state.savingTo }) : t("transfer.saveBrowser")}
        </p>
      </aside>
    </section>
  );
}

/** The measured route, not whether relay servers were on offer. */
const ROUTE: Record<ConnectionPath, MessageKey> = {
  lan: "route.lan",
  internet: "route.internet",
  relay: "route.relay",
  unknown: "route.unknown",
};

function SessionFacts({ state, i18n }: { state: Snapshot; i18n: Translator }) {
  const { t } = i18n;
  // A device session was never named by a code, so the last line says which paired
  // device this is instead.
  const named = state.devices.find((device) => device.id === state.peerDevice);
  return (
    <dl className="facts">
      <dt>{t("transfer.route")}</dt>
      <dd>{state.path ? t(ROUTE[state.path]) : "—"}</dd>
      <dt>{t("transfer.savingIn")}</dt>
      <dd>{state.savingTo ?? t("transfer.browser")}</dd>
      <dt>{t("transfer.limit")}</dt>
      <dd>{state.savingTo ? t("transfer.limitDisk") : formatBytes(maxFileBytes())}</dd>
      {state.mode === "group" ? (
        <>
          <dt>{t("transfer.paired")}</dt>
          <dd>{named?.name ?? state.peerDevice ?? "—"}</dd>
        </>
      ) : (
        <>
          <dt>{t("pairing.code")}</dt>
          <dd>{t("transfer.burned", { code: state.code ?? "----" })}</dd>
        </>
      )}
    </dl>
  );
}

function CopyButton({ text, i18n }: { text: string; i18n: Translator }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--text"
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {})
      }
    >
      {copied ? i18n.t("host.linkCopied") : i18n.t("transfer.copy")}
    </button>
  );
}

/* ── progress rows ─────────────────────────────────────────────────────── */

interface RateState {
  at: number;
  bytes: number;
  rate: number;
}

/**
 * Rate and ETA are derived in the view from progress deltas, smoothed with an
 * EMA so the number reads steadily instead of flickering with every chunk.
 */
function useRate(transfer: TransferView): { rate: number; etaSeconds: number | null } {
  const ref = useRef<RateState>({ at: 0, bytes: transfer.transferred, rate: 0 });
  const s = ref.current;
  const now = performance.now();

  if (transfer.status !== "active") {
    s.at = 0;
    s.rate = 0;
    s.bytes = transfer.transferred;
    return { rate: 0, etaSeconds: null };
  }

  if (s.at === 0) {
    s.at = now;
    s.bytes = transfer.transferred;
    return { rate: 0, etaSeconds: null };
  }

  const dt = (now - s.at) / 1000;
  if (dt >= 0.4) {
    const instant = Math.max(0, transfer.transferred - s.bytes) / dt;
    s.rate = s.rate === 0 ? instant : s.rate * 0.7 + instant * 0.3;
    s.at = now;
    s.bytes = transfer.transferred;
  }

  const remaining = transfer.size - transfer.transferred;
  const etaSeconds = s.rate > 1 ? remaining / s.rate : null;
  return { rate: s.rate, etaSeconds };
}

function formatEta(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds));
  const m = Math.floor(clamped / 60);
  const sec = clamped % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** "267/418 MB" — one unit, so the line stays short. */
function formatPair(done: number, total: number): string {
  const totalText = formatBytes(total);
  const unit = totalText.split(" ")[1] ?? "";
  const div = unit === "GB" ? 1e9 : unit === "MB" ? 1e6 : unit === "KB" || unit === "kB" ? 1e3 : 1;
  const a = done / div;
  const b = total / div;
  const fmt = (n: number) => (n >= 100 || div === 1 ? Math.round(n).toString() : n.toFixed(1));
  return `${fmt(a)}/${fmt(b)} ${unit}`.trim();
}

export function TransferRow({
  transfer,
  client,
  i18n,
}: {
  transfer: TransferView;
  client: GSendClient;
  i18n: Translator;
}) {
  const { t } = i18n;
  const { rate, etaSeconds } = useRate(transfer);

  const pct = transfer.size > 0 ? Math.min(100, (transfer.transferred / transfer.size) * 100) : 0;
  const active = transfer.status === "active" || transfer.status === "pending";
  const stopped = transfer.status === "cancelled" || transfer.status === "error";
  const done = transfer.status === "done";

  const problem = transfer.problem
    ? t(`cancel.${transfer.problem.code}`, { limit: transfer.problem.limit ?? 0 })
    : null;

  const live = transfer.status === "active" && rate > 1;
  const statusText = done
    ? transfer.direction === "send"
      ? t("row.sent")
      : transfer.downloaded
        ? t("row.saved")
        : t("row.received")
    : stopped
      ? (problem ?? t("row.cancelled"))
      : transfer.status === "paused"
        ? t("row.paused")
        : transfer.status === "pending"
          ? t("row.pending")
          : null;
  const meta = [
    statusText ?? formatPair(transfer.transferred, transfer.size),
    live ? `${formatBytes(rate)}/s` : null,
    live && etaSeconds !== null ? t("row.left", { time: formatEta(etaSeconds) }) : null,
  ].filter(Boolean);

  const barClass = done ? "pbar pbar--done" : stopped ? "pbar pbar--dim" : "pbar";

  return (
    <li className={stopped ? "transfer transfer--dim" : "transfer"}>
      <span
        className={active && transfer.direction === "send" ? "transfer__arrow transfer__arrow--live" : "transfer__arrow"}
        aria-hidden="true"
      >
        {/* Drawn rather than typed: system fonts on Windows colour the arrow glyphs. */}
        <svg viewBox="0 0 16 22" style={transfer.direction === "send" ? undefined : { transform: "rotate(180deg)" }}>
          <path
            d="M8 20 C7.6 14 8.3 8 8 2 M2.5 7.5 C4.5 5.8 6.5 4 8 1.8 C9.5 4 11.5 5.8 13.5 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="transfer__name" title={transfer.name}>
        {transfer.name}
      </span>

      <span className="transfer__bar">
        <span
          className={barClass}
          role="progressbar"
          aria-label={transfer.name}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="pbar__fill" style={{ width: `${pct}%` }} />
          {/* The pig rides the front of the bar while bytes are moving. */}
          {transfer.status === "active" && transfer.transferred > 0 && (
            <img className="pbar__pig brand-only" src="/img/fly.webp" alt="" width={54} height={29} style={{ left: `${pct}%` }} />
          )}
        </span>
        <span className="transfer__pct">{Math.floor(pct)}%</span>
      </span>

      <span className="transfer__meta">
        {meta.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </span>

      <span className="transfer__action">
        {done && transfer.savedAs && (
          <span className="transfer__saved" title={transfer.savedAs}>
            {t("row.savedTo", { name: transfer.savedAs })}
          </span>
        )}
        {/* A file already written into their folder needs no button, only its name. */}
        {done && transfer.downloadUrl && !transfer.savedAs && (
          // Still offered once saved, in case the first save went astray, but it steps
          // back so the files that still need a press are the ones that stand out.
          <a
            className={transfer.downloaded ? "btn btn--ghost btn--small" : "btn btn--small"}
            href={transfer.downloadUrl}
            download={transfer.name}
            onClick={() => client.markSaved(transfer.id)}
          >
            {t("transfer.save")}
          </a>
        )}
        {active && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => client.cancelTransfer(transfer.id)}>
            {t("transfer.cancel")}
          </button>
        )}
      </span>
    </li>
  );
}

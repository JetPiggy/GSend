import { useEffect, useRef, useState } from "react";
import type { GSendClient, Snapshot } from "../core/client";
import { formatBytes } from "../core/sink";
import { useI18n } from "../i18n";
import CodeBoxes from "./CodeBoxes";
import { DeviceChips, DeviceManager } from "./DeviceList";
import { DropOverlay, useWindowDrop } from "./drop";
import { HandNote, Stamps } from "./hand";

interface Props {
  client: GSendClient;
  state: Snapshot;
  /** The digits typed so far; held by the app so a failed join keeps them. */
  code: string;
  onCode: (code: string) => void;
  /** The per-file ceiling, said again while a file is held over the page. */
  limitLine: string;
}

const CODE_LENGTH = 4;

/**
 * Receiving is the page: four boxes to type the other screen's code into. Sending is
 * the strip underneath, and a file dropped anywhere on the page is staged for it.
 */
export default function Landing({ client, state, code, onCode, limitLine }: Props) {
  const { t, tm } = useI18n();
  const [focused, setFocused] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState("");
  const [managing, setManaging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const add = (list: Iterable<File> | null) => {
    if (!list) return;
    const picked = [...list];
    if (picked.length > 0) setFiles((current) => [...current, ...picked]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const dragging = useWindowDrop(add);

  const start = () => client.host(files, draft.trim() || null);

  // Enter with nothing in particular focused gets the code, as the button would.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "BUTTON" || tag === "INPUT" || tag === "A" || tag === "TEXTAREA") return;
      start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * Joining connects and does nothing else. It used to open the folder picker first,
   * on the same press, since the picker needs that user activation — but a system
   * dialog appearing where someone had pressed Enter to connect read as the app
   * misbehaving. A folder chosen earlier is still used, restored at startup for as long
   * as the browser keeps the grant, and the connecting and session screens both offer
   * to choose one.
   */
  const join = (event: React.FormEvent) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) return;
    client.join(code);
  };

  const stagedBytes = files.reduce((sum, file) => sum + file.size, 0);
  const caret = focused && code.length < CODE_LENGTH ? code.length : null;
  const error = tm(state.error);

  return (
    <section className="home">
      {dragging && <DropOverlay label={t("landing.dropRelease")} note={limitLine} />}

      <div className="home__ask">
        <h1 className="ask">
          {t("landing.ask")}
          <span className="ask__sub">{t("landing.askSub")}</span>
        </h1>
        <HandNote />
      </div>

      {(state.notice || state.groupDisplaced) && (
        <div className="home__alerts">
          {state.notice && (
            <p className="alert alert--soft" onClick={() => client.dismissNotice()}>
              {tm(state.notice)}
            </p>
          )}
          {/*
            Only one tab per device can be the one the others reach. A tab brought to the
            front takes that over by itself; this is for the one visible but not focused.
          */}
          {state.groupDisplaced && (
            <div className="alert alert--soft alert__row">
              <span>{t("devices.displaced")}</span>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => client.useThisTab()}>
                {t("devices.useThisTab")}
              </button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={join}>
        <CodeBoxes value={code} caret={caret} label={t("landing.codeLabel")}>
          {/*
            The real input sits invisibly over the boxes: taps focus it, the numeric
            keyboard opens, autofill still works, and the boxes render its value.
          */}
          <input
            ref={codeInput}
            className="code-input"
            value={code}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
              onCode(next);
              // The last digit is the whole request, so it is taken as one: no button to
              // find, which on a phone also meant putting the keyboard away first.
              if (next.length === CODE_LENGTH && code.length < CODE_LENGTH) client.join(next);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={t("landing.codeLabel")}
            aria-describedby="code-help"
          />
        </CodeBoxes>
      </form>

      <div className="home__under">
        {/* A failed join is reported where the digits were typed, without moving them. */}
        {error ? (
          <p className="home__error" id="code-help" role="alert">
            {error}
            {code.length === CODE_LENGTH && (
              <button type="button" className="btn btn--text" onClick={() => client.join(code)}>
                {t("landing.joinAgain")}
              </button>
            )}
          </p>
        ) : (
          <p id="code-help">{t("landing.qrHint")}</p>
        )}
        <Stamps />
      </div>

      <section className="strip" aria-labelledby="send-title">
        <div className="strip__title">
          <h2 id="send-title">{t("landing.sendTitle")}</h2>
          {files.length > 0 ? (
            <p className="staged">
              <b>{t("landing.staged", { count: files.length, size: formatBytes(stagedBytes) })}</b>
              <button type="button" className="btn btn--text" onClick={() => setFiles([])}>
                {t("landing.clear")}
              </button>
            </p>
          ) : (
            <p>{t("landing.dropAnywhere")}</p>
          )}
        </div>

        <div className="strip__row">
          <button type="button" className="btn btn--ghost" onClick={() => fileInput.current?.click()}>
            {t("landing.chooseFiles")}
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => add(event.target.files)} />
          <input
            className="field"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Not while an input method is still composing: that Enter picks a word.
              if (event.key === "Enter" && !event.nativeEvent.isComposing) start();
            }}
            placeholder={t("landing.textPlaceholder")}
            aria-label={t("landing.textLabel")}
          />
        </div>

        <button type="button" className="btn" onClick={start}>
          {t("landing.getCode")}
        </button>

        <span className="strip__sep" aria-hidden="true" />

        <DeviceChips
          client={client}
          state={state}
          files={files}
          text={draft}
          managing={managing}
          onManage={() => setManaging((open) => !open)}
        />
      </section>

      {managing && <DeviceManager client={client} state={state} />}
    </section>
  );
}

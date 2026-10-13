import { useState } from "react";
import type { GSendClient, Snapshot } from "../core/client";
import { directPickerSupported } from "../core/sink";
import { useI18n } from "../i18n";

interface ChipsProps {
  client: GSendClient;
  state: Snapshot;
  /** Whatever is staged on the home screen, so a chip can send it outright. */
  files: File[];
  text: string;
  managing: boolean;
  onManage: () => void;
}

/**
 * The devices this one has been paired with, as chips you press to send.
 *
 * Presence comes from the rendezvous room, which this device joins on load, so a chip
 * is live only while the other device also has the page open. Pressing one skips the
 * code entirely: the pairing already established who they are to each other.
 */
export function DeviceChips({ client, state, files, text, managing, onManage }: ChipsProps) {
  const { t } = useI18n();
  const staged = files.length > 0 || text.trim().length > 0;

  return (
    <div className="devices">
      <div className="devices__head">
        <h3>{t("devices.title")}</h3>
        <span className="devices__sub">{t("devices.titleSub")}</span>
        {state.identity && (
          <button type="button" className="btn btn--text" aria-expanded={managing} onClick={onManage}>
            {managing ? t("devices.done") : t("devices.manage")}
          </button>
        )}
      </div>

      {!state.identity ? (
        <p className="devices__none">{t("devices.notRemembered")}</p>
      ) : state.devices.length === 0 ? (
        <p className="devices__none">{t("devices.none")}</p>
      ) : (
        <div className="chips">
          {state.devices.map((device) => {
            const action = !device.online
              ? t("devices.offlineChip", { name: device.name })
              : staged
                ? t("devices.sendTo", { name: device.name })
                : t("devices.connectTo", { name: device.name });
            return (
              <button
                key={device.id}
                type="button"
                className="chip"
                disabled={!device.online}
                title={action}
                aria-label={action}
                onClick={() => client.connectToDevice(device.id, files, text.trim() || null)}
              >
                <span className="chip__dot" aria-hidden="true" />
                <span className="chip__name">{device.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Renaming this device, unpairing others, and where files sent to it land. */
export function DeviceManager({ client, state }: { client: GSendClient; state: Snapshot }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!state.identity) return null;

  const commitName = () => {
    setEditing(false);
    if (draft.trim()) void client.rename(draft);
  };

  return (
    <section className="sheet manage" aria-labelledby="manage-title">
      <h3 id="manage-title">{t("devices.manageTitle")}</h3>

      <ul className="manage__list">
        <li className="manage__item">
          {editing ? (
            <input
              className="field manage__rename"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") commitName();
                if (event.key === "Escape") setEditing(false);
              }}
              aria-label={t("devices.namePrompt")}
            />
          ) : (
            <span className="manage__name">{state.identity.name}</span>
          )}
          <span className="manage__meta">
            {t("devices.thisDevice")}
            {!state.groupOnline && ` · ${t("devices.offline")}`}
          </span>
          {!editing && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                setDraft(state.identity?.name ?? "");
                setEditing(true);
              }}
            >
              {t("devices.rename")}
            </button>
          )}
        </li>

        {state.devices.map((device) => (
          <li key={device.id} className="manage__item">
            <span className="manage__name" title={device.id}>
              {device.name}
            </span>
            <span className="manage__meta">{device.online ? t("devices.online") : t("devices.offline")}</span>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void client.unpair(device.id)}>
              {t("devices.unpair")}
            </button>
          </li>
        ))}
      </ul>

      <p className="manage__note">{t("devices.offlineNote")}</p>

      {/*
        A paired device receives without anyone pressing anything, so its destination
        has to be settled beforehand rather than on a click that never comes. Chosen
        once, it is remembered for as long as the pairing is.
      */}
      {directPickerSupported() && (
        <p className="manage__note">
          {state.savingTo ? t("devices.savingTo", { folder: state.savingTo }) : t("devices.savingNowhere")}
          <button type="button" className="btn btn--text" onClick={() => void client.chooseFolder()}>
            {t(state.savingTo ? "devices.changeFolder" : "transfer.chooseFolder")}
          </button>
        </p>
      )}

      {state.devices.length > 0 && (
        <div>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void client.unpairAll()}>
            {t("devices.unpairAll")}
          </button>
        </div>
      )}
    </section>
  );
}

import { useI18n } from "../i18n";

/**
 * The red handwriting: a note with an arrow down at the code, and the three stamps.
 * Both are brand dress only, so work mode drops them along with the pig.
 */

export function HandNote() {
  const { t } = useI18n();
  return (
    <p className="home__note hand-note brand-only">
      <svg viewBox="0 0 70 90" aria-hidden="true">
        <path
          d="M58 8 C30 18 16 40 20 80 M8 66 C13 72 17 77 20 82 C25 76 29 72 35 68"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {t("hand.note")}
    </p>
  );
}

export function Stamps() {
  const { t } = useI18n();
  return (
    <ul className="stamps brand-only">
      <li>{t("hand.stamp1")}</li>
      <li>{t("hand.stamp2")}</li>
      <li>{t("hand.stamp3")}</li>
    </ul>
  );
}

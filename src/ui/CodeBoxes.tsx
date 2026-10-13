import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * The four big boxes: the code being typed on the receiving side, and the code shown on
 * the sending side. They are the page; the pig sits on the last one.
 *
 * Each digit is stamped in as it arrives, and the pig hops when one does. The boxes are
 * put down one by one only the first time they appear in a visit, never again on the
 * way back from a session.
 */

const LENGTH = 4;
let introPlayed = false;

interface Props {
  /** The digits to show, left to right. */
  value: string;
  /** The box holding the caret, while the hidden input has focus. */
  caret?: number | null;
  /** Waiting for a code: the boxes pulse instead of showing digits. */
  pending?: boolean;
  /** The digits arrive together (a code being handed out), so stamp them one by one. */
  stagger?: boolean;
  label: string;
  /** The hidden input that takes the typing, laid over the boxes. */
  children?: ReactNode;
}

export default function CodeBoxes({ value, caret = null, pending = false, stagger = false, label, children }: Props) {
  const [intro] = useState(() => !introPlayed);
  useEffect(() => {
    introPlayed = true;
  }, []);

  // A hop per new digit: keying the image on the count restarts its animation.
  const [hops, setHops] = useState(0);
  const seen = useRef(value.length);
  useEffect(() => {
    if (value.length > seen.current) setHops((count) => count + 1);
    seen.current = value.length;
  }, [value.length]);

  return (
    <div
      className={["code-row", intro && "code-row--intro", stagger && "code-row--stagger"].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
    >
      {Array.from({ length: LENGTH }, (_, index) => {
        const digit = value[index];
        const active = caret === index;
        return (
          <div
            key={index}
            className={active ? "code-box code-box--active" : "code-box"}
            style={{ "--i": index } as CSSProperties}
            aria-hidden="true"
          >
            {digit !== undefined ? (
              <span key={digit} className="code-box__digit">
                {digit}
              </span>
            ) : pending ? (
              <span className="code-box__dot" />
            ) : active ? (
              <span className="code-box__caret" />
            ) : null}
          </div>
        );
      })}
      <div className={hops > 0 ? "code-pig code-pig--hop brand-only" : "code-pig brand-only"} aria-hidden="true">
        <img key={hops} src="/img/sit.webp" alt="" width={400} height={458} />
      </div>
      {children}
    </div>
  );
}

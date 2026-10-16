import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

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
  /** The hidden input's selection while it has focus, from `useCodeEditing`. */
  selection?: BoxSelection | null;
  /** Waiting for a code: the boxes pulse instead of showing digits. */
  pending?: boolean;
  /** The digits arrive together (a code being handed out), so stamp them one by one. */
  stagger?: boolean;
  label: string;
  /** The hidden input that takes the typing, laid over the boxes. */
  children?: ReactNode;
}

export default function CodeBoxes({ value, selection = null, pending = false, stagger = false, label, children }: Props) {
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
        const [start, end] = selection ?? [-1, -1];
        // A digit the next one typed replaces, or the empty box it goes into.
        const marked = digit !== undefined && index >= start && index < end;
        const caret = digit === undefined && start === end && index === start;
        return (
          <div
            key={index}
            className={marked || caret ? "code-box code-box--active" : "code-box"}
            style={{ "--i": index } as CSSProperties}
            aria-hidden="true"
          >
            {digit !== undefined ? (
              <span key={digit} className="code-box__digit">
                {digit}
              </span>
            ) : pending ? (
              <span className="code-box__dot" />
            ) : caret ? (
              <span className="code-box__caret" />
            ) : null}
            {marked && <span className="code-box__mark" />}
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

type BoxSelection = [start: number, end: number];

/**
 * Editing the code in place, for the hidden input laid over the boxes. A caret inside
 * the code selects the digit after it, so the next digit typed replaces that one as it
 * would in a box of its own, and a tap selects the box under it. Past the digits typed
 * so far, a tap is the next empty box: the code has no gaps.
 */
export function useCodeEditing(): {
  selection: BoxSelection | null;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
} {
  const [selection, setSelection] = useState<BoxSelection | null>(null);

  const settle = (input: HTMLInputElement) => {
    const filled = input.value.length;
    let start = input.selectionStart ?? filled;
    let end = input.selectionEnd ?? start;
    if (start === end && (start < filled || filled === LENGTH)) {
      start = Math.min(start, LENGTH - 1);
      end = start + 1;
      input.setSelectionRange(start, end);
    }
    setSelection([start, end]);
  };

  return {
    selection,
    inputProps: {
      onFocus: (event) => settle(event.currentTarget),
      onSelect: (event) => settle(event.currentTarget),
      // A digit just typed over one moves the selection on; not every browser says so
      // with a select event.
      onInput: (event) => settle(event.currentTarget),
      onBlur: () => setSelection(null),
      onClick: (event) => {
        const input = event.currentTarget;
        const boxes = [...(input.parentElement?.querySelectorAll(".code-box") ?? [])];
        const index = boxes.findIndex((box) => event.clientX < box.getBoundingClientRect().right);
        const at = Math.min(index < 0 ? LENGTH - 1 : index, input.value.length);
        input.setSelectionRange(at, at);
        settle(input);
      },
      onKeyDown: (event) => {
        const input = event.currentTarget;
        const start = input.selectionStart ?? 0;
        // Left from a selected digit would land back on it; go to the one before.
        if (event.key === "ArrowLeft" && !event.shiftKey && start < (input.selectionEnd ?? 0)) {
          event.preventDefault();
          input.setSelectionRange(Math.max(start - 1, 0), Math.max(start - 1, 0));
          settle(input);
        }
        // A letter would replace the selected digit and then be dropped, taking the digit with it.
        if (event.key.length === 1 && !/\d/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
        }
      },
    },
  };
}

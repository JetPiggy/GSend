import { useLayoutEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Enter sends. Shift+Enter is a new line, and Enter while an input method composes picks a word. */
  onEnter: () => void;
  enterKeyHint: "go" | "send";
  placeholder: string;
  label: string;
}

/**
 * The text to send. A textarea, because a one-line input drops the line breaks from
 * whatever is pasted into it before anything is sent. It grows with the text up to a
 * few lines, then scrolls.
 */
export default function TextBox({ value, onChange, onEnter, enterKeyHint, placeholder, label }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the border, which border-box sizing counts.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={box}
      className="field field--text"
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onEnter();
      }}
      enterKeyHint={enterKeyHint}
      placeholder={placeholder}
      aria-label={label}
    />
  );
}

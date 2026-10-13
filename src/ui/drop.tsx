import { useEffect, useRef, useState } from "react";

/**
 * The whole page takes a dropped file, in both looks. There is no drop box to aim at:
 * a file let go anywhere is taken. Screens with nothing to do with a file still refuse
 * it (useDropGuard) rather than let the browser open it, which would navigate away
 * from a live session.
 */

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/** How many mounted screens are taking files; the guard stands aside while any are. */
let takers = 0;

export function useWindowDrop(onFiles: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false);
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    takers += 1;
    let timer = 0;
    const settle = () => {
      window.clearTimeout(timer);
      setOver(false);
    };

    // dragover repeats every few dozen milliseconds while a drag is over the page, even
    // with the pointer still, so its stopping is the reliable sign the drag has left.
    // Counting dragenter against dragleave goes wrong across child elements.
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setOver(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOver(false), 250);
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) settle();
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      settle();
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) handler.current(files);
    };

    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      takers -= 1;
      window.clearTimeout(timer);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return over;
}

/** Mounted once, at the top: a file dropped where nothing takes it is refused. */
export function useDropGuard(): void {
  useEffect(() => {
    const refuse = (event: DragEvent) => {
      if (takers > 0 || !carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", refuse);
    window.addEventListener("drop", refuse);
    return () => {
      window.removeEventListener("dragover", refuse);
      window.removeEventListener("drop", refuse);
    };
  }, []);
}

/** What the page turns into while a file is held over it. */
export function DropOverlay({ label, note }: { label: string; note?: string }) {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <img className="brand-only" src="/img/fly.webp" alt="" width={380} height={207} />
      <p>{label}</p>
      {note && <small>{note}</small>}
    </div>
  );
}

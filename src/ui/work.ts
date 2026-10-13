import { useSyncExternalStore } from "react";

/**
 * Work mode: the same page with only words on it. No pig, no handwriting, no paper,
 * so GSend open on a work screen reads as a tool rather than a toy.
 *
 * A deliberate choice is remembered on this device. A link from someone who had it on
 * (`?w=1`, carried by their QR code and copied link) turns it on for this visit only:
 * the person who sent it is at work, so the screen that opens should not undo that,
 * but it is not this device's choice to keep. index.html applies the class before the
 * first paint from the same two sources, so the pig never flashes up.
 */

const STORAGE_KEY = "gsend.work";
const LINK_PARAM = "w";

const FAVICON = { brand: "/favicon-32.png", work: "/favicon-work-32.png" };
const THEME = { brand: "#F7F3E8", work: "#FFFFFF" };

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function fromLink(): boolean {
  return new URLSearchParams(location.search).get(LINK_PARAM) === "1";
}

let on = stored() || fromLink();
const listeners = new Set<() => void>();

function apply(): void {
  document.documentElement.classList.toggle("work", on);
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = on ? FAVICON.work : FAVICON.brand;
  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (theme) theme.content = on ? THEME.work : THEME.brand;
}

apply();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function get(): boolean {
  return on;
}

export function setWork(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* still applies for this visit */
  }
  apply();
  for (const listener of listeners) listener();
}

export function useWork(): boolean {
  return useSyncExternalStore(subscribe, get, get);
}

/** A link to this session that opens the other screen the way this one looks. */
export function withWork(url: string, work: boolean): string {
  if (!work) return url;
  const parsed = new URL(url);
  parsed.searchParams.set(LINK_PARAM, "1");
  return parsed.toString();
}

/** Keeps at most one audio/video element playing at a time across the whole
 * app — starting one pauses every other registered element. */
const elements = new Set<HTMLMediaElement>();

export function registerMediaElement(el: HTMLMediaElement): void {
  elements.add(el);
  el.addEventListener("play", () => {
    for (const other of elements) {
      if (other !== el && !other.paused) other.pause();
    }
  });
}

export function unregisterMediaElement(el: HTMLMediaElement): void {
  elements.delete(el);
}

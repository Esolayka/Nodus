/** One override slot for "what should a brand-new note be called" — plain
 * module state rather than a full registry, since at most one thing should
 * ever be deciding this at a time (the last plugin to enable wins, same as
 * Obsidian's own "Unique note creator" replacing the default title). */
let provider: (() => string) | null = null;

export function setNoteNameProvider(fn: (() => string) | null): void {
  provider = fn;
}

export function defaultNoteName(fallback: string): string {
  return provider ? provider() : fallback;
}

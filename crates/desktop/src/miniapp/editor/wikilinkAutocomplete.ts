// A lean wikilink autocomplete for the Mini App: fuzzy-matched note titles
// after typing `[[`. Simpler than the desktop's (no recency ranking, no
// heading-level `#` completions) — reuses the same fuzzy matcher so the
// matching behavior at least agrees.

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { fuzzyMatch } from "../../lib/fuzzyMatch";
import type { NoteIndex } from "../../lib/noteIndex";

export function wikilinkCompletionSource(noteIndex: NoteIndex) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[([^\]#|]*)$/);
    if (!match) return null;
    if (match.from === match.to && !context.explicit) return null;

    const query = match.text.slice(2);
    const options: Completion[] = [];
    for (const note of noteIndex.notes) {
      const found = query ? fuzzyMatch(query, note.title) : { indices: [] };
      if (!found) continue;
      options.push({ label: note.title, apply: `${note.title}]]`, boost: -note.title.length });
    }
    return { from: match.from + 2, options, filter: false };
  };
}

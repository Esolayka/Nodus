import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { useVaultStore } from "../store/vaultStore";

/** Triggers on `[[prefix` (no `#`/`|` typed yet) and offers matching note
 * titles, completing to `[[Title]]` (or `[[Title#`/`[[Title|` if the user
 * had already started one of those, left untouched by the trigger regex). */
function wikilinkCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[([^\]#|]*)$/);
  if (!match) return null;
  if (match.from === match.to && !context.explicit) return null;

  const query = match.text.slice(2).toLowerCase();
  const { notes } = useVaultStore.getState().noteIndex;
  const options = notes
    .filter((n) => n.title.toLowerCase().includes(query))
    .slice(0, 50)
    .map((n) => ({
      label: n.title,
      detail: n.path,
      apply: `${n.title}]]`,
    }));

  return {
    from: match.from + 2,
    options,
    filter: false,
  };
}

export const wikilinkAutocomplete = autocompletion({
  override: [wikilinkCompletionSource],
});

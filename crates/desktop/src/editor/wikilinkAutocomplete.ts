import { type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { getNoteHeadings } from "../api/vault";
import i18next from "../i18n";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import { resolveWikilinkTarget } from "../lib/noteIndex";
import { useNoteUsageStore } from "../store/noteUsageStore";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { extractOutline } from "./outline";

/** A completion carrying its fuzzy-match character indices, so `getMatch`
 * (below) can hand them to CodeMirror's own renderer — which is what
 * "подсвечиваются насыщенностью шрифта" (matched characters highlighted by
 * font weight) actually hooks into; see the `cm-completionMatchedText`
 * override in `matchedTextTheme`. */
interface FuzzyCompletion extends Completion {
  matchIndices?: number[];
}

/** Turns sorted individual char indices into the [from, to) pairs
 * `getMatch` expects (contiguous runs merged into one range each). */
function toMatchRanges(indices: number[]): number[] {
  const ranges: number[] = [];
  for (const i of indices) {
    const last = ranges.length - 1;
    if (last >= 0 && ranges[last] === i) {
      ranges[last] = i + 1;
    } else {
      ranges.push(i, i + 1);
    }
  }
  return ranges;
}

function getMatch(completion: Completion): readonly number[] {
  return toMatchRanges((completion as FuzzyCompletion).matchIndices ?? []);
}

/** Default CodeMirror styling for matched characters is just an underline;
 * the spec wants font-weight instead. Uses `baseTheme` (not `theme`) since
 * the completion tooltip is portaled outside the editor's own DOM subtree,
 * where scoped `EditorView.theme()` rules wouldn't reach. */
const matchedTextTheme = EditorView.baseTheme({
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "700",
  },
});

/** `[[prefix` (no `#`/`|` typed yet): note-title completion, fuzzy-matched
 * and sorted recently-opened first, then by open frequency, then
 * alphabetically — matches are found by fuzzy subsequence, but the
 * *ordering* of matches deliberately isn't by match quality. */
function noteCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[([^\]#|]*)$/);
  if (!match) return null;
  if (match.from === match.to && !context.explicit) return null;

  const query = match.text.slice(2);
  const { notes } = useVaultStore.getState().noteIndex;
  const usage = useNoteUsageStore.getState().usage;

  const matched = notes
    .map((n) => ({ note: n, fuzzy: fuzzyMatch(query, n.title) }))
    .filter((m): m is { note: (typeof notes)[number]; fuzzy: NonNullable<typeof m.fuzzy> } =>
      m.fuzzy !== null,
    );

  matched.sort((a, b) => {
    const ua = usage[a.note.path];
    const ub = usage[b.note.path];
    const lastA = ua?.lastOpened ?? 0;
    const lastB = ub?.lastOpened ?? 0;
    if (lastA !== lastB) return lastB - lastA;
    const countA = ua?.count ?? 0;
    const countB = ub?.count ?? 0;
    if (countA !== countB) return countB - countA;
    return a.note.title.localeCompare(b.note.title);
  });

  const options: FuzzyCompletion[] = matched.slice(0, 50).map(({ note, fuzzy }) => ({
    label: note.title,
    detail: note.path,
    apply: `${note.title}]]`,
    matchIndices: fuzzy.indices,
  }));

  if (options.length === 0 && query.trim()) {
    options.push({
      label: i18next.t("wikilink.createNote", { name: query }),
      apply: (view, _completion, from, to) => {
        view.dispatch({ changes: { from, to, insert: `${query}]]` } });
        void useVaultStore.getState().createFile("", query);
      },
    });
  }

  return { from: match.from + 2, options, filter: false, getMatch };
}

/** `[[Note#prefix`: heading completion for whichever note `Note` resolves
 * to. Reads headings live off the editor buffer when that note happens to
 * be open (so unsaved headings still show up), otherwise asks the index. */
function headingCompletionSource(
  path: string,
  context: CompletionContext,
): CompletionResult | Promise<CompletionResult | null> | null {
  const match = context.matchBefore(/\[\[([^\]#|]+)#([^\]|]*)$/);
  if (!match) return null;

  const inner = match.text.slice(2);
  const hashIndex = inner.indexOf("#");
  const noteName = inner.slice(0, hashIndex);
  const query = inner.slice(hashIndex + 1);
  const headingFrom = match.from + 2 + hashIndex + 1;

  const noteIndex = useVaultStore.getState().noteIndex;
  const targetPath = resolveWikilinkTarget(noteIndex, noteName, path);
  if (!targetPath) return null;

  function toResult(headings: { level: number; text: string }[]): CompletionResult {
    const matched = headings
      .map((h) => ({ heading: h, fuzzy: fuzzyMatch(query, h.text) }))
      .filter((m): m is { heading: typeof m.heading; fuzzy: NonNullable<typeof m.fuzzy> } =>
        m.fuzzy !== null,
      );
    const options: FuzzyCompletion[] = matched.map(({ heading, fuzzy }) => ({
      label: heading.text,
      apply: heading.text,
      matchIndices: fuzzy.indices,
    }));
    return { from: headingFrom, options, filter: false, getMatch };
  }

  // If the target note happens to be open in some tab, its buffer may have
  // unsaved headings the on-disk index doesn't know about yet — prefer that
  // over the round-trip.
  const openBuffer = useWorkspaceStore.getState().buffers[targetPath];
  if (openBuffer) {
    return toResult(extractOutline(openBuffer.content));
  }

  return getNoteHeadings(targetPath).then(toResult);
}

/** Completion sources only — NOT wrapped in `autocompletion()`. CodeMirror's
 * `autocompletion()` config (specifically `override`) can only be set once
 * per editor; a second call anywhere else in the same extension list throws
 * "Config merge conflict." `markdownSetup.ts` combines these sources with
 * `tagAutocomplete`'s into a single `autocompletion()` call. */
export function wikilinkCompletionSources(path: string) {
  return [(ctx: CompletionContext) => headingCompletionSource(path, ctx), noteCompletionSource];
}

export { matchedTextTheme };

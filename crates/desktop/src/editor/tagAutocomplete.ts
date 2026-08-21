import { type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import { getCachedTagCounts } from "../lib/tagIndexCache";

interface FuzzyCompletion extends Completion {
  matchIndices?: number[];
}

function toMatchRanges(indices: number[]): number[] {
  const ranges: number[] = [];
  for (const i of indices) {
    const last = ranges.length - 1;
    if (last >= 0 && ranges[last] === i) ranges[last] = i + 1;
    else ranges.push(i, i + 1);
  }
  return ranges;
}

function getMatch(completion: Completion): readonly number[] {
  return toMatchRanges((completion as FuzzyCompletion).matchIndices ?? []);
}

const TRIGGER = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}/-]*)$/u;

function tagCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(TRIGGER);
  if (!match) return null;
  if (match.from === match.to && !context.explicit) return null;

  const query = match.text.slice(1);
  const counts = getCachedTagCounts();
  const matched = counts
    .map((c) => ({ count: c, fuzzy: fuzzyMatch(query, c.tag) }))
    .filter((m): m is { count: (typeof counts)[number]; fuzzy: NonNullable<typeof m.fuzzy> } =>
      m.fuzzy !== null,
    );
  matched.sort((a, b) => b.count.count - a.count.count || a.count.tag.localeCompare(b.count.tag));

  const options: FuzzyCompletion[] = matched.slice(0, 50).map(({ count, fuzzy }) => ({
    label: count.tag,
    apply: count.tag,
    matchIndices: fuzzy.indices,
  }));

  return { from: match.from + 1, options, filter: false, getMatch };
}

/** A completion source only — see the doc comment on
 * `wikilinkCompletionSources` for why this isn't wrapped in its own
 * `autocompletion()` call. */
export function tagCompletionSources() {
  return [tagCompletionSource];
}

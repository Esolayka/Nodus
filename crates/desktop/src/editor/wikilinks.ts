import { type EditorState, Facet, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { resolveWikilinkTarget } from "../lib/noteIndex";
import { useVaultStore } from "../store/vaultStore";
import { codeRanges, inCodeRange } from "./codeRanges";

const WIKILINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;

/** The path of the note this editor instance is showing — needed so
 * ambiguous `[[Name]]` targets resolve to the candidate closest by folder
 * to *this* note, not some arbitrary alphabetical pick. */
const currentNotePath = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

interface ParsedWikilink {
  start: number;
  end: number;
  target: string;
  resolvedPath: string | null;
}

function splitInner(inner: string): { target: string; heading: string | null; alias: string | null } {
  const pipeIdx = inner.indexOf("|");
  const beforeAlias = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
  const alias = pipeIdx === -1 ? null : inner.slice(pipeIdx + 1).trim();
  const hashIdx = beforeAlias.indexOf("#");
  const target = hashIdx === -1 ? beforeAlias : beforeAlias.slice(0, hashIdx);
  const heading = hashIdx === -1 ? null : beforeAlias.slice(hashIdx + 1).trim();
  return { target: target.trim(), heading, alias };
}

function cursorLineRange(state: EditorState): { from: number; to: number } {
  const line = state.doc.lineAt(state.selection.main.head);
  return { from: line.from, to: line.to };
}

function buildDecorations(view: EditorView): { decorations: DecorationSet; links: ParsedWikilink[] } {
  const noteIndex = useVaultStore.getState().noteIndex;
  const fromPath = view.state.facet(currentNotePath);
  const active = cursorLineRange(view.state);
  const text = view.state.doc.toString();
  const code = codeRanges(view.state);
  const decorations: Range<Decoration>[] = [];
  const links: ParsedWikilink[] = [];

  for (const match of text.matchAll(WIKILINK_RE)) {
    const matchStart = match.index ?? 0;
    const isEmbed = match[1] === "!";
    const fullStart = isEmbed ? matchStart : matchStart;
    const fullEnd = matchStart + match[0].length;
    const innerStart = matchStart + match[1].length + 2;
    if (inCodeRange(code, fullStart)) continue; // literal syntax inside code, not a real link
    const { target, alias } = splitInner(match[2]);
    if (!target) continue;

    const resolvedPath = resolveWikilinkTarget(noteIndex, target, fromPath);
    const isActiveLine = fullStart <= active.to && fullEnd >= active.from;

    // Resolved embeds render as a transcluded block via `embeds.ts` instead
    // (needs a StateField, since it's a multi-line-capable replace — see
    // that file), which also owns their click handling — so this plugin
    // stays out of the way entirely while one is collapsed, and doesn't
    // register it as a click target for the generic handler below.
    if (isEmbed && resolvedPath && !isActiveLine) continue;

    links.push({ start: fullStart, end: fullEnd, target, resolvedPath });
    const cls = `cm-wikilink${resolvedPath ? "" : " cm-wikilink-unresolved"}${isEmbed ? " cm-wikilink-embed" : ""}`;

    if (isActiveLine) {
      decorations.push(Decoration.mark({ class: cls }).range(fullStart, fullEnd));
      continue;
    }

    const visibleLabel = alias ?? target;
    const labelStart = innerStart;
    const labelEnd = innerStart + (alias ? match[2].indexOf("|") : visibleLabel.length);

    // Hide the opening marker + everything up to the visible label.
    decorations.push(Decoration.replace({}).range(fullStart, labelStart));
    // Style the visible label itself.
    decorations.push(Decoration.mark({ class: cls }).range(labelStart, labelEnd));
    // Hide the rest (heading/alias/closing `]]`).
    if (labelEnd < fullEnd - 2) {
      decorations.push(Decoration.replace({}).range(labelEnd, fullEnd - 2));
    }
    decorations.push(Decoration.replace({}).range(fullEnd - 2, fullEnd));
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return { decorations: Decoration.set(decorations, true), links };
}

class WikilinkPlugin implements PluginValue {
  decorations: DecorationSet;
  links: ParsedWikilink[];

  constructor(view: EditorView) {
    const built = buildDecorations(view);
    this.decorations = built.decorations;
    this.links = built.links;
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) {
      const built = buildDecorations(update.view);
      this.decorations = built.decorations;
      this.links = built.links;
    }
  }
}

export const wikilinkPlugin = ViewPlugin.fromClass(WikilinkPlugin, {
  decorations: (plugin) => plugin.decorations,
});

export type FollowLink = (target: string, resolvedPath: string | null, newTab: boolean) => void;

/** Plain click navigates in the current tab; Ctrl/Cmd+click and the middle
 * mouse button open a new one — but only when the link is actually showing
 * as a clickable label (not on the cursor's own line, where it's raw,
 * editable markdown and a click there should just place the cursor). */
export function wikilinkClickHandler(onFollowLink: FollowLink) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 && event.button !== 1) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const plugin = view.plugin(wikilinkPlugin);
      const link = plugin?.links.find((l) => pos >= l.start && pos <= l.end);
      if (!link) return false;

      const active = cursorLineRange(view.state);
      const isActiveLine = link.start <= active.to && link.end >= active.from;
      if (isActiveLine) return false;

      event.preventDefault();
      const newTab = event.button === 1 || event.ctrlKey || event.metaKey;
      onFollowLink(link.target, link.resolvedPath, newTab);
      return true;
    },
  });
}

export function wikilinks(path: string, onFollowLink: FollowLink) {
  return [currentNotePath.of(path), wikilinkPlugin, wikilinkClickHandler(onFollowLink)];
}

import type { EditorState, Range } from "@codemirror/state";
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

const WIKILINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;

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
  const active = cursorLineRange(view.state);
  const text = view.state.doc.toString();
  const decorations: Range<Decoration>[] = [];
  const links: ParsedWikilink[] = [];

  for (const match of text.matchAll(WIKILINK_RE)) {
    const matchStart = match.index ?? 0;
    const isEmbed = match[1] === "!";
    const fullStart = isEmbed ? matchStart : matchStart;
    const fullEnd = matchStart + match[0].length;
    const innerStart = matchStart + match[1].length + 2;
    const { target, alias } = splitInner(match[2]);
    if (!target) continue;

    const resolvedPath = resolveWikilinkTarget(noteIndex, target);
    links.push({ start: fullStart, end: fullEnd, target, resolvedPath });

    const isActiveLine = fullStart <= active.to && fullEnd >= active.from;
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

const wikilinkPlugin = ViewPlugin.fromClass(WikilinkPlugin, {
  decorations: (plugin) => plugin.decorations,
});

export type FollowLink = (target: string, resolvedPath: string | null) => void;

export function wikilinkClickHandler(onFollowLink: FollowLink) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.ctrlKey && !event.metaKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const plugin = view.plugin(wikilinkPlugin);
      const link = plugin?.links.find((l) => pos >= l.start && pos <= l.end);
      if (!link) return false;
      event.preventDefault();
      onFollowLink(link.target, link.resolvedPath);
      return true;
    },
  });
}

export function wikilinks(onFollowLink: FollowLink) {
  return [wikilinkPlugin, wikilinkClickHandler(onFollowLink)];
}

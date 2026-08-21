import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { readNote } from "../api/vault";
import i18next from "../i18n";
import { displayName } from "../lib/displayName";
import { resolveWikilinkTarget } from "../lib/noteIndex";
import { renderMiniMarkdown } from "../lib/miniMarkdown";
import { useVaultStore } from "../store/vaultStore";
import { codeRanges, inCodeRange } from "./codeRanges";
import { extractOutline } from "./outline";
import { editorModeField } from "./modeState";
import type { FollowLink } from "./wikilinks";

const EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;

/** "Глубина вложенных встраиваний ограничена тремя уровнями" — the note
 * being edited doesn't count, so this is how many `![[...]]` expansions may
 * stack: edited note -> embed -> embed -> embed, then no further. */
const MAX_EMBED_DEPTH = 3;

function splitTarget(inner: string): { target: string; heading: string | null } {
  const hashIdx = inner.indexOf("#");
  if (hashIdx === -1) return { target: inner.trim(), heading: null };
  return { target: inner.slice(0, hashIdx).trim(), heading: inner.slice(hashIdx + 1).trim() };
}

function extractHeadingSection(content: string, headingText: string): string | null {
  const headings = extractOutline(content);
  const idx = headings.findIndex((h) => h.text.toLowerCase() === headingText.toLowerCase());
  if (idx === -1) return null;
  const target = headings[idx];
  const next = headings.slice(idx + 1).find((h) => h.level <= target.level);
  const end = next ? next.position : content.length;
  return content.slice(target.position, end).trimEnd();
}

function resolve(target: string, fromPath: string): string | null {
  return resolveWikilinkTarget(useVaultStore.getState().noteIndex, target, fromPath);
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly heading: string | null,
    readonly resolvedPath: string,
    readonly ancestors: readonly string[],
    readonly onFollowLink: FollowLink,
  ) {
    super();
  }

  eq(other: EmbedWidget): boolean {
    return (
      this.resolvedPath === other.resolvedPath &&
      this.heading === other.heading &&
      this.ancestors.length === other.ancestors.length &&
      this.ancestors.every((a, i) => a === other.ancestors[i])
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-embed";

    const header = document.createElement("a");
    header.className = "cm-embed-header";
    header.href = "#";
    header.textContent = displayName(this.resolvedPath) + (this.heading ? ` › ${this.heading}` : "");
    header.addEventListener("click", (e) => {
      e.preventDefault();
      this.onFollowLink(this.target, this.resolvedPath, e.ctrlKey || e.metaKey);
    });
    container.appendChild(header);

    const body = document.createElement("div");
    body.className = "cm-embed-body";
    container.appendChild(body);

    if (this.ancestors.includes(this.resolvedPath)) {
      body.textContent = i18next.t("wikilink.embedCycle");
      body.classList.add("cm-embed-error");
      return container;
    }

    readNote(this.resolvedPath)
      .then((content) => {
        const section = this.heading ? extractHeadingSection(content, this.heading) : content;
        if (section == null) {
          body.textContent = i18next.t("wikilink.embedHeadingMissing", { heading: this.heading });
          body.classList.add("cm-embed-error");
          return;
        }
        const nextAncestors = [...this.ancestors, this.resolvedPath];
        // Links inside the embedded note resolve relative to *that* note's
        // own location, not the note doing the embedding.
        const resolveHere = (target: string) => resolve(target, this.resolvedPath);
        body.appendChild(
          renderMiniMarkdown(section, {
            resolve: resolveHere,
            onFollowLink: this.onFollowLink,
            renderEmbed: (target, heading) => {
              // `nextAncestors` includes the root note, so its length is one
              // more than the embed depth reached so far — allow up to
              // MAX_EMBED_DEPTH hops (B, C, D for a limit of 3), block the next.
              if (nextAncestors.length > MAX_EMBED_DEPTH) return null;
              const resolvedPath = resolveHere(target);
              if (!resolvedPath) return null;
              const nested = new EmbedWidget(
                target,
                heading,
                resolvedPath,
                nextAncestors,
                this.onFollowLink,
              );
              return nested.toDOM();
            },
          }),
        );
      })
      .catch(() => {
        body.textContent = i18next.t("wikilink.embedLoadError");
        body.classList.add("cm-embed-error");
      });

    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function cursorLineRange(state: EditorState): { from: number; to: number } {
  const line = state.doc.lineAt(state.selection.main.head);
  return { from: line.from, to: line.to };
}

function buildDecorations(
  state: EditorState,
  currentPath: string,
  onFollowLink: FollowLink,
): DecorationSet {
  const mode = state.field(editorModeField, false) ?? "live";
  if (mode === "source") return Decoration.none;
  const active = mode === "reading" ? { from: -1, to: -2 } : cursorLineRange(state);

  const text = state.doc.toString();
  const code = codeRanges(state);
  const decorations: Range<Decoration>[] = [];
  // The note being edited is itself the root of the embed chain, so a note
  // directly embedding itself is caught immediately, not just indirect cycles.
  const rootAncestors = [currentPath];

  for (const match of text.matchAll(EMBED_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (inCodeRange(code, start)) continue; // literal syntax inside code, not a real embed
    if (start <= active.to && end >= active.from) continue; // active line: let wikilinks.ts show raw text

    const { target, heading } = splitTarget(match[1]);
    const resolvedPath = resolve(target, currentPath);
    if (!resolvedPath) continue; // unresolved: let wikilinks.ts render the usual unresolved-link mark

    decorations.push(
      Decoration.replace({
        widget: new EmbedWidget(target, heading, resolvedPath, rootAncestors, onFollowLink),
      }).range(start, end),
    );
  }

  return Decoration.set(decorations, true);
}

export function embeds(currentPath: string, onFollowLink: FollowLink) {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, currentPath, onFollowLink),
    update: (_decorations, tr) => buildDecorations(tr.state, currentPath, onFollowLink),
    provide: (field) => EditorView.decorations.from(field),
  });
}

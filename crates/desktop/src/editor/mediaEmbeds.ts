import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import i18next from "../i18n";
import { assetUrlFor } from "../lib/assetUrl";
import { mediaKindOf } from "../lib/attachments";
import { buildMediaPlayer, type MediaPlayer } from "../lib/mediaPlayerDom";
import { resolveAssetTarget } from "../lib/noteIndex";
import { loadPdfDocument } from "../lib/pdfjs";
import { useSettingsStore } from "../store/settingsStore";
import { useVaultStore } from "../store/vaultStore";
import { codeRanges, inCodeRange } from "./codeRanges";
import { editorModeField } from "./modeState";
import "./mediaEmbeds.css";

/** A minimal single-item context menu for external images ("save locally")
 * — plain DOM since it's triggered from inside a CodeMirror widget, not React. */
function showImageContextMenu(x: number, y: number, onSaveLocally: () => void): void {
  document.querySelectorAll(".cm-image-context-menu").forEach((el) => el.remove());
  const menu = document.createElement("div");
  menu.className = "cm-image-context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = i18next.t("images.saveLocally");
  item.addEventListener("click", () => {
    onSaveLocally();
    menu.remove();
  });
  menu.appendChild(item);
  document.body.appendChild(menu);

  const dismiss = (e: Event) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", dismiss, true);
      document.removeEventListener("keydown", onKey);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismiss(e);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", onKey);
  }, 0);
}

const EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;
const EXTERNAL_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;

export type OpenLightbox = (imageSrc: string) => void;

function parseInner(inner: string): { target: string; fragment: string | null; sizeSpec: string | null } {
  let rest = inner;
  let sizeSpec: string | null = null;
  const pipeIdx = rest.indexOf("|");
  if (pipeIdx !== -1) {
    sizeSpec = rest.slice(pipeIdx + 1).trim();
    rest = rest.slice(0, pipeIdx);
  }
  let fragment: string | null = null;
  const hashIdx = rest.indexOf("#");
  if (hashIdx !== -1) {
    fragment = rest.slice(hashIdx + 1).trim();
    rest = rest.slice(0, hashIdx);
  }
  return { target: rest.trim(), fragment, sizeSpec };
}

function parseSize(spec: string | null): { width: number | null; height: number | null } {
  if (!spec) return { width: null, height: null };
  const m = /^(\d+)(?:x(\d+))?$/.exec(spec.trim());
  if (!m) return { width: null, height: null };
  return { width: Number(m[1]), height: m[2] ? Number(m[2]) : null };
}

function parsePageFragment(fragment: string | null): number | null {
  if (!fragment) return null;
  const m = /^page=(\d+)$/.exec(fragment);
  return m ? Number(m[1]) : null;
}

function parseTimeFragment(fragment: string | null): number | null {
  if (!fragment) return null;
  const m = /^t=(\d+(?:\.\d+)?)$/.exec(fragment);
  return m ? Number(m[1]) : null;
}

class ImageEmbedWidget extends WidgetType {
  constructor(
    readonly resolvedPath: string,
    readonly width: number | null,
    readonly height: number | null,
    readonly onOpenLightbox: OpenLightbox,
  ) {
    super();
  }

  eq(other: ImageEmbedWidget): boolean {
    return this.resolvedPath === other.resolvedPath && this.width === other.width && this.height === other.height;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-media-embed cm-image-embed-wrap";
    const img = document.createElement("img");
    img.className = "cm-image-embed";
    img.src = assetUrlFor(this.resolvedPath);
    img.alt = this.resolvedPath;
    if (this.width) img.style.width = `${this.width}px`;
    if (this.height) img.style.height = `${this.height}px`;
    if (!this.width) img.style.maxWidth = "100%";
    img.addEventListener("click", () => this.onOpenLightbox(img.src));
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class ExternalImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly loadExternal: boolean,
    readonly onOpenLightbox: OpenLightbox,
    readonly onSaveLocally: (view: EditorView, url: string, alt: string) => void,
  ) {
    super();
  }

  eq(other: ExternalImageWidget): boolean {
    return this.url === other.url && this.alt === other.alt && this.loadExternal === other.loadExternal;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-media-embed cm-image-embed-wrap";

    if (!this.loadExternal) {
      const placeholder = document.createElement("button");
      placeholder.type = "button";
      placeholder.className = "cm-external-image-placeholder";
      placeholder.textContent = this.alt || this.url;
      placeholder.title = this.url;
      placeholder.addEventListener("click", () => {
        const img = document.createElement("img");
        img.className = "cm-image-embed";
        img.src = this.url;
        img.alt = this.alt;
        img.style.maxWidth = "100%";
        img.addEventListener("click", () => this.onOpenLightbox(this.url));
        wrap.replaceChildren(img);
        this.attachContextMenu(img, view);
      });
      wrap.appendChild(placeholder);
      return wrap;
    }

    const img = document.createElement("img");
    img.className = "cm-image-embed";
    img.src = this.url;
    img.alt = this.alt;
    img.style.maxWidth = "100%";
    img.addEventListener("click", () => this.onOpenLightbox(this.url));
    wrap.appendChild(img);
    this.attachContextMenu(img, view);
    return wrap;
  }

  private attachContextMenu(img: HTMLImageElement, view: EditorView): void {
    img.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showImageContextMenu(e.clientX, e.clientY, () => this.onSaveLocally(view, this.url, this.alt));
    });
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class MediaPlayerWidget extends WidgetType {
  private player: MediaPlayer | null = null;

  constructor(
    readonly kind: "audio" | "video",
    readonly resolvedPath: string,
    readonly startTime: number | null,
  ) {
    super();
  }

  eq(other: MediaPlayerWidget): boolean {
    return this.resolvedPath === other.resolvedPath && this.startTime === other.startTime && this.kind === other.kind;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-media-embed cm-av-embed-wrap";
    this.player = buildMediaPlayer(this.kind, assetUrlFor(this.resolvedPath), this.startTime);
    wrap.appendChild(this.player.element);
    return wrap;
  }

  destroy(): void {
    this.player?.destroy();
    this.player = null;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class PdfEmbedWidget extends WidgetType {
  constructor(
    readonly resolvedPath: string,
    readonly page: number,
    readonly onOpenTab: (path: string, page: number) => void,
  ) {
    super();
  }

  eq(other: PdfEmbedWidget): boolean {
    return this.resolvedPath === other.resolvedPath && this.page === other.page;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-media-embed cm-pdf-embed-wrap";
    const canvas = document.createElement("canvas");
    canvas.className = "cm-pdf-embed-canvas";
    wrap.appendChild(canvas);
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "cm-pdf-embed-open";
    openBtn.textContent = `${this.resolvedPath.split("/").pop()} · p.${this.page}`;
    openBtn.addEventListener("click", () => this.onOpenTab(this.resolvedPath, this.page));
    wrap.appendChild(openBtn);

    const url = assetUrlFor(this.resolvedPath);
    loadPdfDocument(url)
      .then((doc) => doc.getPage(Math.min(Math.max(this.page, 1), doc.numPages)))
      .then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(560 / viewport.width, 1.5);
        const scaledViewport = page.getViewport({ scale });
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;
        const ctx = canvas.getContext("2d");
        if (ctx) void page.render({ canvasContext: ctx, viewport: scaledViewport, canvas }).promise;
      })
      .catch(() => {
        wrap.classList.add("cm-media-embed-error");
      });

    return wrap;
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
  fromPath: string,
  onOpenLightbox: OpenLightbox,
  onOpenPdfTab: (path: string, page: number) => void,
  onSaveLocally: (view: EditorView, url: string, alt: string) => void,
): DecorationSet {
  const mode = state.field(editorModeField, false) ?? "live";
  if (mode === "source") return Decoration.none;
  const active = mode === "reading" ? { from: -1, to: -2 } : cursorLineRange(state);

  const text = state.doc.toString();
  const code = codeRanges(state);
  const noteIndex = useVaultStore.getState().noteIndex;
  const decorations: Range<Decoration>[] = [];

  for (const match of text.matchAll(EMBED_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (inCodeRange(code, start)) continue;
    if (start <= active.to && end >= active.from) continue;

    const { target, fragment, sizeSpec } = parseInner(match[1]);
    if (!target) continue;
    const resolvedPath = resolveAssetTarget(noteIndex, target, fromPath);
    if (!resolvedPath) continue; // not an attachment — embeds.ts (notes) or wikilinks.ts (unresolved) handles it

    const kind = mediaKindOf(resolvedPath);
    if (!kind) continue;

    let widget: WidgetType;
    if (kind === "image") {
      const { width, height } = parseSize(sizeSpec);
      widget = new ImageEmbedWidget(resolvedPath, width, height, onOpenLightbox);
    } else if (kind === "audio" || kind === "video") {
      widget = new MediaPlayerWidget(kind, resolvedPath, parseTimeFragment(fragment));
    } else {
      widget = new PdfEmbedWidget(resolvedPath, parsePageFragment(fragment) ?? 1, onOpenPdfTab);
    }

    decorations.push(Decoration.replace({ widget }).range(start, end));
  }

  const loadExternal = useSettingsStore.getState().settings.attachments.loadExternalImages;
  for (const match of text.matchAll(EXTERNAL_IMAGE_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (inCodeRange(code, start)) continue;
    if (start <= active.to && end >= active.from) continue;

    const widget = new ExternalImageWidget(match[2], match[1], loadExternal, onOpenLightbox, onSaveLocally);
    decorations.push(Decoration.replace({ widget }).range(start, end));
  }

  return Decoration.set(decorations, true);
}

export function mediaEmbeds(
  currentPath: string,
  onOpenLightbox: OpenLightbox,
  onOpenPdfTab: (path: string, page: number) => void,
  onSaveLocally: (view: EditorView, url: string, alt: string) => void,
) {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, currentPath, onOpenLightbox, onOpenPdfTab, onSaveLocally),
    update: (_decorations, tr) => buildDecorations(tr.state, currentPath, onOpenLightbox, onOpenPdfTab, onSaveLocally),
    provide: (field) => EditorView.decorations.from(field),
  });
}

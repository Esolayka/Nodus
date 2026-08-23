import i18next from "i18next";
import { EditorView, ViewPlugin, type Command, type ViewUpdate } from "@codemirror/view";
import {
  insertLink,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
} from "./formatting";

const SVG_NS = "http://www.w3.org/2000/svg";

type IconNode = [tag: string, attrs: Record<string, string>];

/** Lucide's own path data (from `lucide-react`'s icon modules), built into
 * real `<svg>` elements by hand — this isn't a React tree, it's a CodeMirror
 * plugin's raw DOM, so the React components can't be used directly. Explicit
 * width/height (not just viewBox) matters here: an inline `<svg>` without
 * them renders 0x0 in the real WebKitGTK runtime even though it looks fine
 * in a Chromium-based dev/test setup. */
function buildIcon(nodes: IconNode[], size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attrs] of nodes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    svg.appendChild(el);
  }
  return svg;
}

const ICONS = {
  bold: [["path", { d: "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" }]],
  italic: [
    ["line", { x1: "19", x2: "10", y1: "4", y2: "4" }],
    ["line", { x1: "14", x2: "5", y1: "20", y2: "20" }],
    ["line", { x1: "15", x2: "9", y1: "4", y2: "20" }],
  ],
  strikethrough: [
    ["path", { d: "M16 4H9a3 3 0 0 0-2.83 4" }],
    ["path", { d: "M14 12a4 4 0 0 1 0 8H6" }],
    ["line", { x1: "4", x2: "20", y1: "12", y2: "12" }],
  ],
  code: [
    ["path", { d: "m18 16 4-4-4-4" }],
    ["path", { d: "m6 8-4 4 4 4" }],
    ["path", { d: "m14.5 4-5 16" }],
  ],
  link: [
    ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2" }],
    ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2" }],
    ["line", { x1: "8", x2: "16", y1: "12", y2: "12" }],
  ],
} satisfies Record<string, IconNode[]>;

interface ToolbarAction {
  labelKey: string;
  icon: IconNode[];
  className: string;
  command: Command;
}

const ACTIONS: ToolbarAction[] = [
  { labelKey: "formatting.bold", icon: ICONS.bold, className: "format-bold", command: toggleBold },
  { labelKey: "formatting.italic", icon: ICONS.italic, className: "format-italic", command: toggleItalic },
  {
    labelKey: "formatting.strikethrough",
    icon: ICONS.strikethrough,
    className: "format-strikethrough",
    command: toggleStrikethrough,
  },
  {
    labelKey: "formatting.inlineCode",
    icon: ICONS.code,
    className: "format-code",
    command: toggleInlineCode,
  },
  { labelKey: "formatting.link", icon: ICONS.link, className: "format-link", command: insertLink },
];

class SelectionToolbarView {
  readonly dom: HTMLDivElement;
  private readonly buttons: Array<{ button: HTMLButtonElement; labelKey: string }> = [];
  private readonly onScroll: () => void;
  private readonly onResize: () => void;
  private readonly onLanguageChanged: () => void;
  private readonly onPointerDown: () => void;
  private readonly onPointerUp: () => void;
  private pointerSelecting = false;

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-selection-toolbar";
    this.dom.setAttribute("role", "toolbar");

    for (const action of ACTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className;
      button.appendChild(buildIcon(action.icon));
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        action.command(this.view);
        this.view.focus();
        this.position();
      });
      this.buttons.push({ button, labelKey: action.labelKey });
      this.dom.appendChild(button);
    }

    this.view.dom.appendChild(this.dom);
    this.onScroll = () => this.position();
    this.onResize = () => this.position();
    this.onLanguageChanged = () => this.translate();
    this.onPointerDown = () => {
      this.pointerSelecting = true;
      this.dom.classList.remove("visible");
    };
    this.onPointerUp = () => {
      if (!this.pointerSelecting) return;
      this.pointerSelecting = false;
      this.position();
    };
    this.view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.view.contentDOM.addEventListener("pointerdown", this.onPointerDown);
    document.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("resize", this.onResize);
    i18next.on("languageChanged", this.onLanguageChanged);
    this.translate();
    this.position();
  }

  update(update: ViewUpdate) {
    if (
      update.selectionSet ||
      update.docChanged ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.position();
    }
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.view.contentDOM.removeEventListener("pointerdown", this.onPointerDown);
    document.removeEventListener("pointerup", this.onPointerUp);
    document.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("resize", this.onResize);
    i18next.off("languageChanged", this.onLanguageChanged);
    this.dom.remove();
  }

  private translate() {
    this.dom.setAttribute("aria-label", i18next.t("formatting.toolbar"));
    for (const { button, labelKey } of this.buttons) {
      const label = i18next.t(labelKey);
      button.title = label;
      button.setAttribute("aria-label", label);
    }
  }

  private position() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        if (this.pointerSelecting) return null;
        const range = view.state.selection.main;
        const editable = view.state.facet(EditorView.editable);
        if (!view.hasFocus || !editable || range.empty) return null;

        const head = view.coordsAtPos(range.head, range.head > range.anchor ? -1 : 1);
        const editorRect = view.dom.getBoundingClientRect();
        const scrollRect = view.scrollDOM.getBoundingClientRect();
        if (!head || head.bottom < scrollRect.top || head.top > scrollRect.bottom) return null;

        const halfWidth = this.dom.offsetWidth / 2;
        const left = Math.min(
          editorRect.width - halfWidth - 8,
          Math.max(halfWidth + 8, head.left - editorRect.left),
        );
        const above = head.top - editorRect.top - 8;
        return {
          left,
          top: above >= this.dom.offsetHeight + 4
            ? above
            : head.bottom - editorRect.top + 8,
          below: above < this.dom.offsetHeight + 4,
        };
      },
      write: (measurement) => {
        if (!measurement) {
          this.dom.classList.remove("visible");
          return;
        }
        this.dom.style.left = `${measurement.left}px`;
        this.dom.style.top = `${measurement.top}px`;
        this.dom.classList.toggle("below", measurement.below);
        this.dom.classList.add("visible");
      },
    });
  }
}

export const selectionToolbar = ViewPlugin.define(
  (view) => new SelectionToolbarView(view),
);

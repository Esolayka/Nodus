import i18next from "i18next";
import { EditorView, ViewPlugin, type Command, type ViewUpdate } from "@codemirror/view";
import {
  insertLink,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
} from "./formatting";

interface ToolbarAction {
  labelKey: string;
  text: string;
  className: string;
  command: Command;
}

const ACTIONS: ToolbarAction[] = [
  { labelKey: "formatting.bold", text: "B", className: "format-bold", command: toggleBold },
  { labelKey: "formatting.italic", text: "I", className: "format-italic", command: toggleItalic },
  {
    labelKey: "formatting.strikethrough",
    text: "S",
    className: "format-strikethrough",
    command: toggleStrikethrough,
  },
  {
    labelKey: "formatting.inlineCode",
    text: "</>",
    className: "format-code",
    command: toggleInlineCode,
  },
  { labelKey: "formatting.link", text: "⌁", className: "format-link", command: insertLink },
];

class SelectionToolbarView {
  readonly dom: HTMLDivElement;
  private readonly buttons: Array<{ button: HTMLButtonElement; labelKey: string }> = [];
  private readonly onScroll: () => void;
  private readonly onResize: () => void;
  private readonly onLanguageChanged: () => void;

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-selection-toolbar";
    this.dom.setAttribute("role", "toolbar");

    for (const action of ACTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className;
      button.textContent = action.text;
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
    this.view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
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

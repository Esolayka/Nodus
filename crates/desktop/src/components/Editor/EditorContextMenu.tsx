import { EditorSelection } from "@codemirror/state";
import { EditorView, type Command } from "@codemirror/view";
import {
  Bold,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  Code2,
  Copy,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  ListPlus,
  ListTodo,
  Minus,
  Paintbrush,
  Pilcrow,
  Quote,
  Scissors,
  SquareCode,
  Strikethrough,
  TextSelect,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  insertLink,
  insertWikiLink,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
} from "../../editor/formatting";
import "./EditorContextMenu.css";

interface EditorContextMenuProps {
  x: number;
  y: number;
  view: EditorView;
  onClose: () => void;
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
  onPointerEnter?: () => void;
}

type SubmenuId = "formatting" | "paragraph" | "insert";
type LineStyle = "paragraph" | "heading1" | "heading2" | "heading3" | "bullet" | "numbered" | "task" | "quote";

const MENU_WIDTH = 236;
const VIEWPORT_GAP = 8;
const URL_RE = /^https?:\/\/\S+$/i;

function runCommand(view: EditorView, command: Command): void {
  command(view);
  view.focus();
}

function selectedLineNumbers(view: EditorView): number[] {
  const { from, to } = view.state.selection.main;
  const start = view.state.doc.lineAt(from).number;
  let end = view.state.doc.lineAt(to).number;
  if (to > from && to === view.state.doc.line(end).from) end -= 1;
  return Array.from({ length: Math.max(1, end - start + 1) }, (_, index) => start + index);
}

function setLineStyle(view: EditorView, style: LineStyle): void {
  const lines = selectedLineNumbers(view).map((number) => view.state.doc.line(number));
  const blockPrefix = /^(?:#{1,6}\s+|-\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s+)?/;
  const everyMatches = (pattern: RegExp) => lines.every((line) => pattern.test(line.text));
  const removeOnly = style === "paragraph";
  const toggleOff =
    style === "bullet" ? everyMatches(/^[-*+]\s+/) :
    style === "numbered" ? everyMatches(/^\d+\.\s+/) :
    style === "task" ? everyMatches(/^-\s+\[[ xX]\]\s+/) :
    style === "quote" ? everyMatches(/^>\s+/) :
    false;

  const changes = lines.map((line, index) => {
    const pattern = blockPrefix;
    let insert = "";
    if (style === "heading1") insert = "# ";
    else if (style === "heading2") insert = "## ";
    else if (style === "heading3") insert = "### ";
    else if (style === "bullet") {
      insert = toggleOff ? "" : "- ";
    } else if (style === "numbered") {
      insert = toggleOff ? "" : `${index + 1}. `;
    } else if (style === "task") {
      insert = toggleOff ? "" : "- [ ] ";
    } else if (style === "quote") {
      insert = toggleOff ? "" : "> ";
    }
    const match = pattern.exec(line.text)?.[0] ?? "";
    return { from: line.from, to: line.from + match.length, insert: removeOnly ? "" : insert };
  });

  view.dispatch({ changes, userEvent: "input" });
  view.focus();
}

function insertSnippet(view: EditorView, before: string, after: string, placeholder = ""): void {
  const changes = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const content = selected || placeholder;
    const insert = `${before}${content}${after}`;
    const contentFrom = range.from + before.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: content
        ? EditorSelection.range(contentFrom, contentFrom + content.length)
        : EditorSelection.cursor(contentFrom),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
}

function insertText(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

async function writeSelection(view: EditorView): Promise<boolean> {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const text = view.state.sliceDoc(from, to);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("[editor-context-menu] clipboard write failed:", error);
    return false;
  }
}

async function copySelection(view: EditorView): Promise<void> {
  await writeSelection(view);
  view.focus();
}

async function cutSelection(view: EditorView): Promise<void> {
  if (!(await writeSelection(view))) return;
  view.dispatch(view.state.replaceSelection(""));
  view.focus();
}

async function pasteClipboard(view: EditorView, plainText: boolean): Promise<void> {
  view.focus();
  try {
    const text = await navigator.clipboard.readText();
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const insert = !plainText && selected && URL_RE.test(text.trim())
      ? `[${selected}](${text.trim()})`
      : text;
    view.dispatch(view.state.replaceSelection(insert));
    view.focus();
  } catch (error) {
    console.error("[editor-context-menu] clipboard read failed:", error);
  }
}

function MenuItem({ icon: Icon, label, shortcut, disabled, onSelect, onPointerEnter }: MenuItemProps) {
  return (
    <button
      type="button"
      className="editor-context-item"
      disabled={disabled}
      onClick={onSelect}
      onPointerEnter={onPointerEnter}
    >
      <Icon size={16} strokeWidth={1.75} />
      <span className="editor-context-label">{label}</span>
      {shortcut && <span className="editor-context-shortcut">{shortcut}</span>}
    </button>
  );
}

export function EditorContextMenu({ x, y, view, onClose }: EditorContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuId | null>(null);
  const requestedX = Number.isFinite(x) ? x : VIEWPORT_GAP;
  const requestedY = Number.isFinite(y) ? y : VIEWPORT_GAP;
  const [position, setPosition] = useState(() => ({
    x: Math.min(Math.max(requestedX, VIEWPORT_GAP), window.innerWidth - MENU_WIDTH - VIEWPORT_GAP),
    y: Math.max(requestedY, VIEWPORT_GAP),
  }));
  const range = view.state.selection.main;
  const hasSelection = !range.empty;
  const editable = view.state.facet(EditorView.editable);
  const canReadClipboard = typeof navigator.clipboard?.readText === "function";
  const submenuLeft = position.x + MENU_WIDTH * 2 + 6 > window.innerWidth;
  const submenuUp = position.y > window.innerHeight / 2;

  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      x: Math.min(Math.max(requestedX, VIEWPORT_GAP), window.innerWidth - box.width - VIEWPORT_GAP),
      y: Math.min(Math.max(requestedY, VIEWPORT_GAP), window.innerHeight - box.height - VIEWPORT_GAP),
    });
  }, [requestedX, requestedY]);

  useEffect(() => {
    const dismissPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const dismiss = () => onClose();
    document.addEventListener("pointerdown", dismissPointer, true);
    document.addEventListener("keydown", dismissKey);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismissPointer, true);
      document.removeEventListener("keydown", dismissKey);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [onClose]);

  function select(action: () => void | Promise<void>) {
    const result = action();
    if (result instanceof Promise) void result.catch((error) => console.error("[editor-context-menu] action failed:", error));
    onClose();
  }

  function submenuButton(id: SubmenuId, icon: LucideIcon, label: string) {
    const Icon = icon;
    return (
      <div className="editor-context-submenu-wrap" onPointerEnter={() => setOpenSubmenu(id)}>
        <button
          type="button"
          className="editor-context-item editor-context-submenu-trigger"
          aria-haspopup="menu"
          aria-expanded={openSubmenu === id}
          onClick={() => setOpenSubmenu((current) => current === id ? null : id)}
        >
          <Icon size={16} strokeWidth={1.75} />
          <span className="editor-context-label">{label}</span>
          <ChevronRight size={15} strokeWidth={1.75} />
        </button>
        {openSubmenu === id && (
          <div className={`editor-context-submenu${submenuLeft ? " submenu-left" : ""}${submenuUp ? " submenu-up" : ""}`} role="menu">
            {id === "formatting" && (
              <>
                <MenuItem icon={Bold} label={t("editorContextMenu.bold")} shortcut="Ctrl+B" disabled={!editable} onSelect={() => select(() => runCommand(view, toggleBold))} />
                <MenuItem icon={Italic} label={t("editorContextMenu.italic")} shortcut="Ctrl+I" disabled={!editable} onSelect={() => select(() => runCommand(view, toggleItalic))} />
                <MenuItem icon={Strikethrough} label={t("editorContextMenu.strikethrough")} disabled={!editable} onSelect={() => select(() => runCommand(view, toggleStrikethrough))} />
                <MenuItem icon={Code2} label={t("editorContextMenu.inlineCode")} disabled={!editable} onSelect={() => select(() => runCommand(view, toggleInlineCode))} />
              </>
            )}
            {id === "paragraph" && (
              <>
                <MenuItem icon={Pilcrow} label={t("editorContextMenu.normalParagraph")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "paragraph"))} />
                <MenuItem icon={Heading1} label={t("editorContextMenu.heading1")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "heading1"))} />
                <MenuItem icon={Heading2} label={t("editorContextMenu.heading2")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "heading2"))} />
                <MenuItem icon={Heading3} label={t("editorContextMenu.heading3")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "heading3"))} />
                <div className="editor-context-separator" />
                <MenuItem icon={List} label={t("editorContextMenu.bulletList")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "bullet"))} />
                <MenuItem icon={ListOrdered} label={t("editorContextMenu.numberedList")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "numbered"))} />
                <MenuItem icon={ListTodo} label={t("editorContextMenu.taskList")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "task"))} />
                <MenuItem icon={Quote} label={t("editorContextMenu.quote")} disabled={!editable} onSelect={() => select(() => setLineStyle(view, "quote"))} />
              </>
            )}
            {id === "insert" && (
              <>
                <MenuItem icon={Minus} label={t("editorContextMenu.horizontalRule")} disabled={!editable} onSelect={() => select(() => insertText(view, "\n---\n"))} />
                <MenuItem icon={SquareCode} label={t("editorContextMenu.codeBlock")} disabled={!editable} onSelect={() => select(() => insertSnippet(view, "```\n", "\n```"))} />
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return createPortal(
    <div
      ref={menuRef}
      className="editor-context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuItem icon={Link} label={t("editorContextMenu.insertInternalLink")} disabled={!editable} onPointerEnter={() => setOpenSubmenu(null)} onSelect={() => select(() => runCommand(view, insertWikiLink))} />
      <MenuItem icon={ExternalLink} label={t("editorContextMenu.insertExternalLink")} disabled={!editable} onPointerEnter={() => setOpenSubmenu(null)} onSelect={() => select(() => runCommand(view, insertLink))} />
      <div className="editor-context-separator" />
      {submenuButton("formatting", Paintbrush, t("editorContextMenu.formatting"))}
      {submenuButton("paragraph", Pilcrow, t("editorContextMenu.paragraph"))}
      {submenuButton("insert", ListPlus, t("editorContextMenu.insert"))}
      <div className="editor-context-separator" />
      <MenuItem icon={Scissors} label={t("editorContextMenu.cut")} disabled={!editable || !hasSelection} onPointerEnter={() => setOpenSubmenu(null)} onSelect={() => select(() => cutSelection(view))} />
      <MenuItem icon={Copy} label={t("editorContextMenu.copy")} disabled={!hasSelection} onPointerEnter={() => setOpenSubmenu(null)} onSelect={() => select(() => copySelection(view))} />
      <MenuItem icon={ClipboardPaste} label={t("editorContextMenu.paste")} disabled={!editable || !canReadClipboard} onPointerEnter={() => setOpenSubmenu(null)} onSelect={() => select(() => pasteClipboard(view, false))} />
      <MenuItem icon={Clipboard} label={t("editorContextMenu.pastePlain")} disabled={!editable || !canReadClipboard} onPointerEnter={() => setOpenSubmenu(null)} onSelect={() => select(() => pasteClipboard(view, true))} />
      <MenuItem icon={TextSelect} label={t("editorContextMenu.selectAll")} onPointerEnter={() => setOpenSubmenu(null)} onSelect={() => select(() => {
        view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length), scrollIntoView: true });
        view.focus();
      })} />
    </div>,
    document.body,
  );
}

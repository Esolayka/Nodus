import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CircleX } from "lucide-react";
import { fuzzyMatch } from "../../lib/fuzzyMatch";
import { useNoteUsageStore } from "../../store/noteUsageStore";
import { useUiStore } from "../../store/uiStore";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import "./QuickSwitcher.css";

interface RankedNote {
  path: string;
  title: string;
  indices: number[];
}

type OpenMode = "current" | "newTab" | "split";

export function QuickSwitcher() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.quickSwitcherOpen);
  const setOpen = useUiStore((s) => s.setQuickSwitcherOpen);
  const notes = useVaultStore((s) => s.noteIndex.notes);
  const usage = useNoteUsageStore((s) => s.usage);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const ranked = useMemo<RankedNote[]>(() => {
    const trimmed = query.trim();
    const matched: RankedNote[] = [];
    for (const note of notes) {
      if (!trimmed) {
        matched.push({ path: note.path, title: note.title, indices: [] });
        continue;
      }
      const fuzzy = fuzzyMatch(trimmed, note.title);
      if (fuzzy) matched.push({ path: note.path, title: note.title, indices: fuzzy.indices });
    }
    matched.sort((a, b) => {
      const ua = usage[a.path];
      const ub = usage[b.path];
      const lastA = ua?.lastOpened ?? 0;
      const lastB = ub?.lastOpened ?? 0;
      if (lastA !== lastB) return lastB - lastA;
      const countA = ua?.count ?? 0;
      const countB = ub?.count ?? 0;
      if (countA !== countB) return countB - countA;
      return a.title.localeCompare(b.title);
    });
    return matched;
  }, [notes, query, usage]);

  function close() {
    setOpen(false);
  }

  async function openEntry(index: number, mode: OpenMode, forceCreate = false) {
    const trimmed = query.trim();
    const entry = ranked[index];
    let path: string;
    if (forceCreate && trimmed) path = await useVaultStore.getState().createFile("", trimmed);
    else if (entry) path = entry.path;
    else if (trimmed) path = await useVaultStore.getState().createFile("", trimmed);
    else return;

    if (mode === "split") await useWorkspaceStore.getState().openNote(path, { split: true });
    else await useWorkspaceStore.getState().navigateTo(path, { newTab: mode === "newTab" });
    close();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(ranked.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const mode: OpenMode = e.altKey && (e.ctrlKey || e.metaKey)
          ? "split"
          : e.ctrlKey || e.metaKey
            ? "newTab"
            : "current";
        void openEntry(selected, mode, e.shiftKey);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ranked, selected, query]);

  if (!open) return null;

  const showCreateOption = ranked.length === 0 && query.trim().length > 0;

  return createPortal(
    <div
      ref={backdropRef}
      className="settings-overlay quick-switcher-overlay"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) close();
      }}
    >
      <div className="quick-switcher" role="dialog" aria-modal="true">
        <div className="quick-switcher-input-row">
          <input
            ref={inputRef}
            className="quick-switcher-input"
            placeholder={t("quickSwitcher.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
          <button type="button" className="quick-switcher-close" aria-label={t("quickSwitcher.cancel")} onClick={close}>
            <CircleX size={18} strokeWidth={1.75} />
          </button>
        </div>
        <ul className="quick-switcher-list">
          {showCreateOption ? (
            <li>
              <button
                type="button"
                className="quick-switcher-item quick-switcher-item-active"
                onClick={() => void openEntry(0, "current", true)}
              >
                {t("quickSwitcher.createNote", { name: query.trim() })}
              </button>
            </li>
          ) : (
            ranked.map((entry, i) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className={`quick-switcher-item${i === selected ? " quick-switcher-item-active" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={(e) => void openEntry(
                    i,
                    e.altKey && (e.ctrlKey || e.metaKey)
                      ? "split"
                      : e.ctrlKey || e.metaKey
                        ? "newTab"
                        : "current",
                  )}
                >
                  <span className="quick-switcher-item-title">
                    <HighlightedText text={entry.title} indices={entry.indices} />
                  </span>
                  <span className="quick-switcher-item-path">{entry.path}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="quick-switcher-footer">
          <span><kbd>↑↓</kbd> {t("quickSwitcher.navigate")}</span>
          <span><kbd>↵</kbd> {t("quickSwitcher.open")}</span>
          <span><kbd>Ctrl ↵</kbd> {t("quickSwitcher.openNewTab")}</span>
          <span><kbd>Ctrl Alt ↵</kbd> {t("quickSwitcher.openRight")}</span>
          <span><kbd>Shift ↵</kbd> {t("quickSwitcher.create")}</span>
          <span><kbd>Esc</kbd> {t("quickSwitcher.cancel")}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  const indexSet = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) => (indexSet.has(i) ? <b key={i}>{ch}</b> : <span key={i}>{ch}</span>))}
    </>
  );
}

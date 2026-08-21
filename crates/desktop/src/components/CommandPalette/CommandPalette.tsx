import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getCommandsSnapshot, runCommand, subscribeCommands, type Command } from "../../lib/commandRegistry";
import { fuzzyMatch } from "../../lib/fuzzyMatch";
import { useCommandUsageStore } from "../../store/commandUsageStore";
import { useUiStore } from "../../store/uiStore";
import "./CommandPalette.css";

interface RankedCommand {
  command: Command;
  indices: number[];
}

export function CommandPalette() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const commands = useSyncExternalStore(subscribeCommands, getCommandsSnapshot);
  const usage = useCommandUsageStore((s) => s.usage);
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

  const ranked = useMemo<RankedCommand[]>(() => {
    const trimmed = query.trim();
    const matched: RankedCommand[] = [];
    for (const command of commands) {
      if (!trimmed) {
        matched.push({ command, indices: [] });
        continue;
      }
      const fuzzy = fuzzyMatch(trimmed, command.title);
      if (fuzzy) matched.push({ command, indices: fuzzy.indices });
    }
    matched.sort((a, b) => {
      const ua = usage[a.command.id]?.lastUsed ?? 0;
      const ub = usage[b.command.id]?.lastUsed ?? 0;
      if (ua !== ub) return ub - ua;
      return a.command.title.localeCompare(b.command.title);
    });
    return matched;
  }, [commands, query, usage]);

  function close() {
    setOpen(false);
  }

  function execute(index: number) {
    const entry = ranked[index];
    if (!entry) return;
    useCommandUsageStore.getState().recordUse(entry.command.id);
    runCommand(entry.command.id);
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
        setSelected((s) => Math.min(s + 1, ranked.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        execute(selected);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ranked, selected]);

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      className="settings-overlay command-palette-overlay"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) close();
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="command-palette-input"
          placeholder={t("commandPalette.placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
        />
        <ul className="command-palette-list">
          {ranked.length === 0 ? (
            <li className="command-palette-empty">{t("commandPalette.empty")}</li>
          ) : (
            ranked.map((entry, i) => (
              <li key={entry.command.id}>
                <button
                  type="button"
                  className={`command-palette-item${i === selected ? " command-palette-item-active" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => execute(i)}
                >
                  <span className="command-palette-item-title">
                    <HighlightedText text={entry.command.title} indices={entry.indices} />
                  </span>
                  {entry.command.hotkeyLabel && (
                    <span className="command-palette-item-hotkey">{entry.command.hotkeyLabel}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  const indexSet = useMemo(() => new Set(indices), [indices]);
  return (
    <>
      {[...text].map((ch, i) => (indexSet.has(i) ? <b key={i}>{ch}</b> : <span key={i}>{ch}</span>))}
    </>
  );
}

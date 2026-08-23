import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaseSensitive, SlidersHorizontal } from "lucide-react";
import * as api from "../../api/vault";
import { displayName } from "../../lib/displayName";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { ReplaceFilePreview, SearchFileResult } from "../../types/vault";
import { ReplaceConfirmDialog } from "./ReplaceConfirmDialog";
import { Tooltip } from "../ui/Tooltip";
import "./SearchPanel.css";

const DEBOUNCE_MS = 120;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function highlightedLine(text: string, ranges: [number, number][]) {
  if (ranges.length === 0) return text;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const parts: { text: string; hl: boolean }[] = [];
  let cursor = 0;
  for (const [from, to] of sorted) {
    if (from > cursor) parts.push({ text: text.slice(cursor, from), hl: false });
    parts.push({ text: text.slice(from, to), hl: true });
    cursor = Math.max(cursor, to);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hl: false });
  return parts.map((p, i) => (p.hl ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>));
}

/** The operators the search DSL actually parses (see `search.rs`) — kept in
 * one place so the hint never lists syntax that doesn't really work.
 * Obsidian also has `section:` and `[property]`; this vault doesn't
 * support those (yet), so they're deliberately left off rather than
 * advertised and silently ignored. */
const SEARCH_OPERATORS = ["path:", "file:", "tag:", "line:"];

export function SearchPanel() {
  const { t } = useTranslation();
  const query = useUiStore((s) => s.searchQuery);
  const setQuery = useUiStore((s) => s.setSearchQuery);
  const mode = useUiStore((s) => s.searchPanelMode);
  const setMode = useUiStore((s) => s.setSearchPanelMode);
  const jumpToLine = useWorkspaceStore((s) => s.jumpToLine);

  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [helpForced, setHelpForced] = useState(false);
  const debouncedQuery = useDebounced(query, DEBOUNCE_MS);
  const showHelp = mode === "search" && (helpForced || (inputFocused && query.trim() === ""));

  const [replaceWith, setReplaceWith] = useState("");
  const [skipCodeBlocks, setSkipCodeBlocks] = useState(true);
  const [replacePreview, setReplacePreview] = useState<ReplaceFilePreview[]>([]);
  const [uncheckedLines, setUncheckedLines] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastAppliedCount, setLastAppliedCount] = useState<number | null>(null);
  const debouncedReplaceWith = useDebounced(replaceWith, DEBOUNCE_MS);

  useEffect(() => {
    if (mode !== "search") return;
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setResults([]);
      setElapsedMs(null);
      return;
    }
    let cancelled = false;
    const start = performance.now();
    api.searchVault(trimmed, caseSensitive).then((r) => {
      if (cancelled) return;
      setResults(r);
      setElapsedMs(performance.now() - start);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, debouncedQuery, caseSensitive]);

  useEffect(() => {
    if (mode !== "replace") return;
    const find = debouncedQuery.trim();
    if (!find) {
      setReplacePreview([]);
      return;
    }
    let cancelled = false;
    api.previewReplace(find, debouncedReplaceWith, skipCodeBlocks).then((preview) => {
      if (!cancelled) setReplacePreview(preview);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, debouncedQuery, debouncedReplaceWith, skipCodeBlocks]);

  const totalMatches = useMemo(
    () => results.reduce((sum, r) => sum + r.matches.length, 0),
    [results],
  );
  const lineKey = (path: string, line: number) => `${path}:${line}`;
  const selectedCount = useMemo(() => {
    let count = 0;
    for (const file of replacePreview) {
      for (const m of file.matches) {
        if (!uncheckedLines.has(lineKey(file.path, m.line))) count++;
      }
    }
    return count;
  }, [replacePreview, uncheckedLines]);

  function toggleCollapsed(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleLine(path: string, line: number) {
    setUncheckedLines((prev) => {
      const next = new Set(prev);
      const key = lineKey(path, line);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function applyReplace() {
    const selected = replacePreview.flatMap((file) =>
      file.matches
        .filter((m) => !uncheckedLines.has(lineKey(file.path, m.line)))
        .map((m) => ({ path: file.path, line: m.line })),
    );
    setConfirmOpen(false);
    const changed = await api.applyReplace(debouncedQuery.trim(), debouncedReplaceWith, selected);
    setLastAppliedCount(changed.length);
    setReplacePreview([]);
  }

  async function undo() {
    await api.undoLastReplace();
    setLastAppliedCount(null);
  }

  return (
    <div className="search-panel">
      <div className="search-panel-modes">
        <button
          type="button"
          className={`search-mode-btn${mode === "search" ? " search-mode-btn-active" : ""}`}
          onClick={() => setMode("search")}
        >
          {t("search.searchMode")}
        </button>
        <button
          type="button"
          className={`search-mode-btn${mode === "replace" ? " search-mode-btn-active" : ""}`}
          onClick={() => setMode("replace")}
        >
          {t("search.replaceMode")}
        </button>
      </div>

      <div className="search-input-row">
        <input
          className="search-panel-input"
          placeholder={mode === "search" ? t("search.placeholder") : t("search.findPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          autoFocus
        />
        {mode === "search" && (
          <>
            <Tooltip label={t("search.caseSensitive")} placement="top">
              <button
                type="button"
                className={`search-input-btn${caseSensitive ? " active" : ""}`}
                aria-pressed={caseSensitive}
                onClick={() => setCaseSensitive((v) => !v)}
              >
                <CaseSensitive size={16} strokeWidth={1.75} />
              </button>
            </Tooltip>
            <Tooltip label={t("search.syntaxHelp")} placement="top">
              <button
                type="button"
                className={`search-input-btn${helpForced ? " active" : ""}`}
                aria-pressed={helpForced}
                onClick={() => setHelpForced((v) => !v)}
              >
                <SlidersHorizontal size={16} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {showHelp && (
        <div className="search-syntax-help">
          {SEARCH_OPERATORS.map((op) => (
            <code key={op}>{op}</code>
          ))}
        </div>
      )}

      {mode === "replace" && (
        <>
          <input
            className="search-panel-input"
            placeholder={t("search.replacePlaceholder")}
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
          />
          <label className="search-skip-code">
            <input
              type="checkbox"
              checked={skipCodeBlocks}
              onChange={(e) => setSkipCodeBlocks(e.target.checked)}
            />
            {t("search.skipCodeBlocks")}
          </label>
        </>
      )}

      {mode === "search" && (
        <div className="search-panel-summary">
          {query.trim() && (
            <span>
              {t("search.resultsSummary", { count: totalMatches, files: results.length })}
              {elapsedMs != null && ` · ${Math.round(elapsedMs)} ms`}
            </span>
          )}
        </div>
      )}

      {mode === "search" ? (
        <ul className="search-results-list">
          {results.map((file) => (
            <li key={file.path} className="search-result-file">
              <button
                type="button"
                className="search-result-file-header"
                onClick={() => toggleCollapsed(file.path)}
              >
                <span className={`search-collapse-caret${collapsed.has(file.path) ? " collapsed" : ""}`}>
                  ▾
                </span>
                <span className="search-result-file-name">{displayName(file.path)}</span>
                <span className="search-result-file-count">{file.matches.length}</span>
              </button>
              {!collapsed.has(file.path) && (
                <ul className="search-result-lines">
                  {file.matches.map((m) => (
                    <li key={m.line}>
                      <button
                        type="button"
                        className="search-result-line"
                        onClick={() => void jumpToLine(file.path, m.line, m.ranges[0])}
                      >
                        {highlightedLine(m.text, m.ranges)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <>
          {lastAppliedCount != null && (
            <div className="search-replace-done">
              {t("search.replaceDone", { count: lastAppliedCount })}
              <button type="button" onClick={() => void undo()}>
                {t("search.undo")}
              </button>
            </div>
          )}
          <ul className="search-results-list">
            {replacePreview.map((file) => (
              <li key={file.path} className="search-result-file">
                <div className="search-result-file-header search-result-file-header-static">
                  <span className="search-result-file-name">{displayName(file.path)}</span>
                  <span className="search-result-file-count">{file.matches.length}</span>
                </div>
                <ul className="search-result-lines">
                  {file.matches.map((m) => (
                    <li key={m.line} className="search-replace-line">
                      <label>
                        <input
                          type="checkbox"
                          checked={!uncheckedLines.has(lineKey(file.path, m.line))}
                          onChange={() => toggleLine(file.path, m.line)}
                        />
                        <span className="search-replace-before">{m.before}</span>
                        <span className="search-replace-arrow">→</span>
                        <span className="search-replace-after">{m.after}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {replacePreview.length > 0 && (
            <button
              type="button"
              className="search-replace-apply-btn"
              disabled={selectedCount === 0}
              onClick={() => setConfirmOpen(true)}
            >
              {t("search.applyReplace", { count: selectedCount })}
            </button>
          )}
        </>
      )}

      {confirmOpen && (
        <ReplaceConfirmDialog
          fileCount={new Set(replacePreview.map((f) => f.path)).size}
          matchCount={selectedCount}
          onConfirm={() => void applyReplace()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CaseSensitive,
  ChevronLeft,
  Info,
  Search as SearchIcon,
  SlidersHorizontal,
} from "lucide-react";
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
const SEARCH_OPERATORS = [
  { operator: "path:", descriptionKey: "search.operatorPath" },
  { operator: "file:", descriptionKey: "search.operatorFile" },
  { operator: "tag:", descriptionKey: "search.operatorTag" },
  { operator: "line:", descriptionKey: "search.operatorLine" },
] as const;

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
  const [helpForced, setHelpForced] = useState(false);
  const debouncedQuery = useDebounced(query, DEBOUNCE_MS);
  const showHelp = mode === "search" && helpForced;

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
      {mode === "replace" && (
        <div className="search-replace-header">
          <button
            type="button"
            className="search-replace-back"
            aria-label={t("search.backToSearch")}
            onClick={() => setMode("search")}
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <span>{t("search.replaceMode")}</span>
        </div>
      )}

      <div className="search-input-row">
        <div className="search-input-shell">
          <SearchIcon className="search-input-icon" size={16} strokeWidth={1.75} />
          <input
            className="search-panel-input"
            placeholder={mode === "search" ? t("search.placeholder") : t("search.findPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {mode === "search" && (
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
          )}
        </div>
        {mode === "search" && (
          <Tooltip label={t("search.syntaxHelp")} placement="top">
            <button
              type="button"
              className={`search-settings-btn${helpForced ? " active" : ""}`}
              aria-label={t("search.syntaxHelp")}
              aria-expanded={showHelp}
              onClick={() => setHelpForced((v) => !v)}
            >
              <SlidersHorizontal size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        )}
      </div>

      {showHelp && (
        <div className="search-syntax-help" role="dialog" aria-label={t("search.syntaxHelp")}>
          <div className="search-syntax-title">
            <span>{t("search.syntaxHelp")}</span>
            <Info size={16} strokeWidth={1.75} />
          </div>
          <div className="search-syntax-operators">
            {SEARCH_OPERATORS.map(({ operator, descriptionKey }) => (
              <div className="search-syntax-row" key={operator}>
                <code>{operator}</code>
                <span>{t(descriptionKey)}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="search-open-replace"
            onClick={() => {
              setHelpForced(false);
              setMode("replace");
            }}
          >
            {t("search.openReplace")}
          </button>
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
          {query.trim() && elapsedMs != null && (
            <span>
              {results.length === 0
                ? t("search.noResults")
                : t("search.resultsSummary", { count: totalMatches, files: results.length })}
              {` · ${Math.round(elapsedMs)} ms`}
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

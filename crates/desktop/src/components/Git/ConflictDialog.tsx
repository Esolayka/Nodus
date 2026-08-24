import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSyncStore } from "../../store/syncStore";
import type { ConflictChoice, MergeSegment } from "../../types/vault";
import "./ConflictDialog.css";

function resolvedText(segment: Extract<MergeSegment, { kind: "conflict" }>, choice: ConflictChoice | undefined): string {
  if (choice === "mine") return segment.mine;
  if (choice === "theirs") return segment.theirs;
  if (choice === "both") return `${segment.mine}\n${segment.theirs}`;
  return "";
}

// Mirrors the Rust-side `resolve_segments` exactly: every segment (clean
// text, or the chosen side of a conflict) becomes its own "part" — "both"
// contributes mine and theirs as two separate parts — and the whole part
// list is rejoined with "\n", since `parse_conflict_markers` consumed that
// newline as the line-split delimiter rather than keeping it in a segment.
function buildFinalText(segments: MergeSegment[], choices: Record<number, ConflictChoice>): string {
  const parts: string[] = [];
  for (const [i, segment] of segments.entries()) {
    if (segment.kind === "clean") {
      parts.push(segment.text);
      continue;
    }
    const choice = choices[i];
    if (choice === "mine") parts.push(segment.mine);
    else if (choice === "theirs") parts.push(segment.theirs);
    else if (choice === "both") {
      parts.push(segment.mine);
      parts.push(segment.theirs);
    }
  }
  return parts.join("\n");
}

export function ConflictDialog({
  paths,
  branch,
  onClose,
}: {
  paths: string[];
  branch: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const conflictSegments = useSyncStore((s) => s.conflictSegments);
  const finalizeResolvedMerge = useSyncStore((s) => s.finalizeResolvedMerge);

  const [selectedPath, setSelectedPath] = useState(paths[0]);
  const [segments, setSegments] = useState<MergeSegment[] | null>(null);
  const [choices, setChoices] = useState<Record<number, ConflictChoice>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSegments(null);
    setChoices({});
    setLoadError(null);
    conflictSegments(selectedPath)
      .then((loaded) => {
        if (!cancelled) setSegments(loaded);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, conflictSegments]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const conflictCount = useMemo(
    () => (segments ?? []).filter((s) => s.kind === "conflict").length,
    [segments],
  );
  const allChosen = useMemo(
    () =>
      conflictCount > 0 &&
      (segments ?? []).every((s, i) => s.kind !== "conflict" || choices[i] !== undefined),
    [segments, choices, conflictCount],
  );
  const allResolved = paths.every((p) => p in resolutions);

  function saveResolution() {
    if (!segments || !allChosen) return;
    const text = buildFinalText(segments, choices);
    setResolutions((prev) => ({ ...prev, [selectedPath]: text }));
    const remaining = paths.filter((p) => p !== selectedPath && !(p in resolutions));
    if (remaining.length > 0) setSelectedPath(remaining[0]);
  }

  async function finish() {
    setFinalizing(true);
    try {
      await finalizeResolvedMerge(branch, resolutions);
      onClose();
    } catch {
      // The error is already recorded in the sync log; keep the dialog open
      // so the user can retry instead of losing their resolved choices.
    } finally {
      setFinalizing(false);
    }
  }

  return createPortal(
    <div className="settings-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="conflict-dialog" role="dialog" aria-modal="true">
        <div className="conflict-dialog-header">
          <h2>{t("conflict.title")}</h2>
          <button type="button" className="settings-close" aria-label={t("settings.close")} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="conflict-dialog-body">
          <div className="conflict-files-list">
            {paths.map((path) => (
              <button
                key={path}
                type="button"
                className={`conflict-file-row${path === selectedPath ? " active" : ""}${path in resolutions ? " resolved" : ""}`}
                onClick={() => setSelectedPath(path)}
              >
                <span className="conflict-file-path">{path}</span>
                <span className="conflict-file-status">
                  {path in resolutions ? t("conflict.resolved") : t("conflict.unresolved")}
                </span>
              </button>
            ))}
          </div>

          <div className="conflict-view">
            {loadError ? (
              <p className="git-error">{t("conflict.loadFailed")}</p>
            ) : segments == null ? (
              <p className="side-panel-empty">…</p>
            ) : (
              <>
                <div className="conflict-columns-header">
                  <span>{t("conflict.mine")}</span>
                  <span>{t("conflict.result")}</span>
                  <span>{t("conflict.theirs")}</span>
                </div>
                <div className="conflict-hunks">
                  {segments.map((segment, i) =>
                    segment.kind === "clean" ? (
                      <div key={i} className="conflict-clean">
                        {segment.text}
                      </div>
                    ) : (
                      <div key={i} className="conflict-hunk">
                        <pre className="conflict-pane conflict-pane-mine">{segment.mine}</pre>
                        <div className="conflict-pane conflict-pane-result">
                          <pre>{resolvedText(segment, choices[i]) || t("conflict.emptyResult")}</pre>
                          <div className="conflict-choice-buttons">
                            <button
                              type="button"
                              className={choices[i] === "mine" ? "active" : ""}
                              onClick={() => setChoices((prev) => ({ ...prev, [i]: "mine" }))}
                            >
                              {t("conflict.takeMine")}
                            </button>
                            <button
                              type="button"
                              className={choices[i] === "both" ? "active" : ""}
                              onClick={() => setChoices((prev) => ({ ...prev, [i]: "both" }))}
                            >
                              {t("conflict.takeBoth")}
                            </button>
                            <button
                              type="button"
                              className={choices[i] === "theirs" ? "active" : ""}
                              onClick={() => setChoices((prev) => ({ ...prev, [i]: "theirs" }))}
                            >
                              {t("conflict.takeTheirs")}
                            </button>
                          </div>
                        </div>
                        <pre className="conflict-pane conflict-pane-theirs">{segment.theirs}</pre>
                      </div>
                    ),
                  )}
                </div>
                <div className="conflict-view-footer">
                  <p className="conflict-hint">{t("conflict.allResolvedHint")}</p>
                  <button
                    type="button"
                    className="btn-accent"
                    disabled={!allChosen}
                    onClick={saveResolution}
                  >
                    {t("conflict.resolved")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="conflict-dialog-footer">
          <button type="button" disabled={!allResolved || finalizing} className="btn-accent" onClick={() => void finish()}>
            {finalizing ? t("conflict.finishing") : t("conflict.finish")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

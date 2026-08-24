import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import type { ObsidianInspection } from "../../types/vault";
import "../FileTree/RenameConfirmDialog.css";
import "./ObsidianImportDialog.css";

interface Props {
  path: string;
  inspection: ObsidianInspection;
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** Shown right after picking a folder that turns out to already be an
 * Obsidian vault: no files are copied or converted (Nodus reads the same
 * Markdown natively), this just offers to carry over a few `.obsidian/`
 * settings, and reports every construct found that depends on an
 * Obsidian plugin Nodus doesn't run — so the user learns about it on the
 * very first open, not a week later. */
export function ObsidianImportDialog({ path, inspection, onOpen, onClose }: Props) {
  const { t } = useTranslation();
  const setSettings = useSettingsStore((s) => s.setSettings);
  const settings = useSettingsStore((s) => s.settings);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const { settings: obsidian, incompatibilities } = inspection;
  const hasAttachmentFolder = obsidian.attachmentFolder != null && obsidian.attachmentFolder !== "";
  const hasTemplateFolder = obsidian.templateFolder != null && obsidian.templateFolder !== "";
  const hasDailyNotes = obsidian.dailyNoteFolder != null || obsidian.dailyNoteFormat != null;

  const [applyAttachments, setApplyAttachments] = useState(hasAttachmentFolder);
  const [applyTemplates, setApplyTemplates] = useState(hasTemplateFolder);
  const [applyDailyNotes, setApplyDailyNotes] = useState(hasDailyNotes);
  const [reportExpanded, setReportExpanded] = useState(false);

  const byPlugin = useMemo(() => {
    const counts = new Map<string, number>();
    for (const block of incompatibilities) {
      counts.set(block.plugin, (counts.get(block.plugin) ?? 0) + 1);
    }
    return counts;
  }, [incompatibilities]);

  const affectedNotes = useMemo(() => new Set(incompatibilities.map((b) => b.path)).size, [incompatibilities]);

  function applyAndOpen() {
    if (applyAttachments && obsidian.attachmentFolder) {
      setSettings({
        attachments: { ...settings.attachments, mode: "vaultFolder", vaultFolderName: obsidian.attachmentFolder },
      });
    }
    if (applyTemplates && obsidian.templateFolder) {
      setSettings({ templates: { folder: obsidian.templateFolder } });
    }
    if (applyDailyNotes && (obsidian.dailyNoteFolder != null || obsidian.dailyNoteFormat != null)) {
      setSettings({
        dailyNotes: {
          ...settings.dailyNotes,
          folder: obsidian.dailyNoteFolder ?? settings.dailyNotes.folder,
          filenameFormat: obsidian.dailyNoteFormat ?? settings.dailyNotes.filenameFormat,
        },
      });
    }
    onOpen(path);
    onClose();
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="rename-confirm-modal obsidian-import-modal" role="dialog" aria-modal="true">
        <p className="rename-confirm-title">{t("obsidianImport.title")}</p>
        <p className="obsidian-import-subtitle">{t("obsidianImport.subtitle")}</p>

        {(hasAttachmentFolder || hasTemplateFolder || hasDailyNotes) && (
          <div className="obsidian-import-settings">
            {hasAttachmentFolder && (
              <label className="obsidian-import-row">
                <input type="checkbox" checked={applyAttachments} onChange={(e) => setApplyAttachments(e.target.checked)} />
                <span>{t("obsidianImport.attachmentFolder", { folder: obsidian.attachmentFolder })}</span>
              </label>
            )}
            {hasTemplateFolder && (
              <label className="obsidian-import-row">
                <input type="checkbox" checked={applyTemplates} onChange={(e) => setApplyTemplates(e.target.checked)} />
                <span>{t("obsidianImport.templateFolder", { folder: obsidian.templateFolder })}</span>
              </label>
            )}
            {hasDailyNotes && (
              <label className="obsidian-import-row">
                <input type="checkbox" checked={applyDailyNotes} onChange={(e) => setApplyDailyNotes(e.target.checked)} />
                <span>
                  {t("obsidianImport.dailyNotes", {
                    folder: obsidian.dailyNoteFolder ?? settings.dailyNotes.folder,
                    format: obsidian.dailyNoteFormat ?? settings.dailyNotes.filenameFormat,
                  })}
                </span>
              </label>
            )}
          </div>
        )}

        {incompatibilities.length > 0 ? (
          <div className="obsidian-import-report">
            <button type="button" className="obsidian-import-report-toggle" onClick={() => setReportExpanded((v) => !v)}>
              {t("obsidianImport.reportSummary", { count: incompatibilities.length, notes: affectedNotes })}
              <span className="obsidian-import-report-plugins">
                {" "}
                ({Array.from(byPlugin.entries()).map(([plugin, count]) => `${plugin}: ${count}`).join(", ")})
              </span>
              <span className="obsidian-import-report-chevron">
                {reportExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            </button>
            {reportExpanded && (
              <ul className="rename-confirm-list obsidian-import-report-list">
                {incompatibilities.map((block, i) => (
                  <li key={i}>
                    <div className="obsidian-import-report-location">
                      {block.path}:{block.line} · {block.plugin}
                    </div>
                    <pre className="obsidian-import-report-content">{block.rawContent}</pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="obsidian-import-report-none">{t("obsidianImport.reportNone")}</p>
        )}

        <div className="rename-confirm-actions">
          <button type="button" className="rename-confirm-cancel" onClick={onClose}>
            {t("fileTree.renameConfirmCancel")}
          </button>
          <button type="button" className="rename-confirm-apply" onClick={applyAndOpen}>
            {t("obsidianImport.openVault")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

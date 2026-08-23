import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { collectInputPrompts } from "../../lib/templateEngine";
import { createNoteFromTemplate, insertTemplateAtCursor, listTemplates, type TemplateFile } from "../../lib/templates";
import * as api from "../../api/vault";
import type { TemplateDialogMode } from "../../store/uiStore";
import "../FileTree/RenameConfirmDialog.css";
import "./TemplateFlowDialog.css";

type Step = "pick" | "inputs";

/** Handles both "insert template at cursor" and "create note from
 * template": pick a template (typing a note name too, for "create"), then —
 * only if that template actually has `{{input:...}}` marks — one more step
 * collecting those answers in a single dialog. */
export function TemplateFlowDialog({ mode, onClose }: { mode: Exclude<TemplateDialogMode, null>; onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("pick");
  const [templates, setTemplates] = useState<TemplateFile[]>([]);
  const [chosen, setChosen] = useState<TemplateFile | null>(null);
  const [noteName, setNoteName] = useState(t("templates.untitled"));
  const [prompts, setPrompts] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTemplates(listTemplates());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function choose(template: TemplateFile) {
    setChosen(template);
    const raw = await api.readNote(template.path);
    const found = collectInputPrompts(raw);
    if (found.length === 0) {
      await run(template, []);
      return;
    }
    setPrompts(found);
    setAnswers(found.map(() => ""));
    setStep("inputs");
  }

  async function run(template: TemplateFile, inputAnswers: string[]) {
    const promptForInputs = async () => inputAnswers;
    if (mode === "insert") {
      await insertTemplateAtCursor(template.path, promptForInputs);
    } else {
      await createNoteFromTemplate(template.path, noteName.trim() || t("templates.untitled"), promptForInputs);
    }
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
      <div className="rename-confirm-modal" role="dialog" aria-modal="true">
        {step === "pick" ? (
          <>
            <p className="rename-confirm-title">
              {mode === "insert" ? t("templates.insertTitle") : t("templates.createTitle")}
            </p>
            {mode === "create" && (
              <input
                className="field"
                style={{ padding: "8px 10px" }}
                value={noteName}
                onChange={(e) => setNoteName(e.target.value)}
                placeholder={t("templates.noteNamePlaceholder")}
                autoFocus
              />
            )}
            {templates.length === 0 ? (
              <p className="side-panel-empty">{t("templates.empty")}</p>
            ) : (
              <ul className="rename-confirm-list">
                {templates.map((template) => (
                  <li key={template.path}>
                    <button
                      type="button"
                      className="template-pick-btn"
                      onClick={() => void choose(template)}
                    >
                      {template.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="rename-confirm-actions">
              <button type="button" className="rename-confirm-cancel" onClick={onClose}>
                {t("fileTree.renameConfirmCancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="rename-confirm-title">{t("templates.inputsTitle", { template: chosen?.title ?? "" })}</p>
            {prompts.map((prompt, i) => (
              <input
                key={i}
                className="field"
                style={{ padding: "8px 10px" }}
                placeholder={prompt || t("templates.inputPlaceholder")}
                value={answers[i]}
                autoFocus={i === 0}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))
                }
              />
            ))}
            <div className="rename-confirm-actions">
              <button type="button" className="rename-confirm-cancel" onClick={onClose}>
                {t("fileTree.renameConfirmCancel")}
              </button>
              <button
                type="button"
                className="rename-confirm-apply"
                onClick={() => chosen && void run(chosen, answers)}
              >
                {t("templates.insertApply")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

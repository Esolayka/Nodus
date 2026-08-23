import { useState } from "react";
import { useTranslation } from "react-i18next";
import { appendLineToToday } from "../dailyNote";
import { hapticSuccess } from "../telegram";
import { BottomSheet } from "./BottomSheet";

export function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await appendLineToToday(text.trim());
      hapticSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <h3 className="miniapp-sheet-title">{t("miniapp.quickAdd.title")}</h3>
      <textarea
        className="field quick-add-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("miniapp.quickAdd.placeholder")}
        rows={3}
        autoFocus
      />
      {error && <p className="editor-conflict-banner">{error}</p>}
      <button type="button" className="miniapp-primary-btn" disabled={saving || !text.trim()} onClick={() => void handleAdd()}>
        {saving ? t("miniapp.quickAdd.adding") : t("miniapp.quickAdd.add")}
      </button>
    </BottomSheet>
  );
}

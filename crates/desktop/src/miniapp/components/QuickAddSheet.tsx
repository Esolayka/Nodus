import { useState } from "react";
import { appendLineToToday } from "../dailyNote";
import { BottomSheet } from "./BottomSheet";

export function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await appendLineToToday(text.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <h3 className="miniapp-sheet-title">Add to today's note</h3>
      <textarea
        className="field quick-add-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a line…"
        rows={3}
        autoFocus
      />
      {error && <p className="editor-conflict-banner">{error}</p>}
      <button type="button" className="miniapp-primary-btn" disabled={saving || !text.trim()} onClick={() => void handleAdd()}>
        {saving ? "Adding…" : "Add"}
      </button>
    </BottomSheet>
  );
}

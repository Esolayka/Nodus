import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { haptic } from "../telegram";

export function BottomSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      className="miniapp-sheet-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && (haptic(), onClose())}
    >
      <div className="miniapp-sheet">
        <div className="miniapp-sheet-handle" />
        <button
          type="button"
          className="miniapp-sheet-close"
          onClick={() => (haptic(), onClose())}
          aria-label={t("miniapp.sheet.close")}
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

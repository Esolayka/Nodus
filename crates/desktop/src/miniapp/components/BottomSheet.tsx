import { X } from "lucide-react";
import { haptic } from "../telegram";

export function BottomSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="miniapp-sheet-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && (haptic(), onClose())}
    >
      <div className="miniapp-sheet">
        <div className="miniapp-sheet-handle" />
        <button type="button" className="miniapp-sheet-close" onClick={() => (haptic(), onClose())} aria-label="Close">
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

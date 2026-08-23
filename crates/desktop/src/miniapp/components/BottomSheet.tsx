import { X } from "lucide-react";

export function BottomSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="miniapp-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="miniapp-sheet">
        <div className="miniapp-sheet-handle" />
        <button type="button" className="miniapp-sheet-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

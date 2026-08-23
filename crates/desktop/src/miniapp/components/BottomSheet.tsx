export function BottomSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="miniapp-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="miniapp-sheet">
        <div className="miniapp-sheet-handle" />
        {children}
      </div>
    </div>
  );
}

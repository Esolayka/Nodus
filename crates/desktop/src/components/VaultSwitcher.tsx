import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, FolderCog } from "lucide-react";
import { useTranslation } from "react-i18next";

interface VaultSwitcherProps {
  vaultPath: string | null;
  onOpenAnother: () => void;
}

export function VaultSwitcher({ vaultPath, onOpenAnother }: VaultSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const vaultName = vaultPath?.split(/[\\/]/).pop() || "Vault";

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="vault-switcher" ref={rootRef}>
      <button
        type="button"
        className={`sidebar-vault-path${open ? " active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronsUpDown size={14} className="sidebar-vault-icon" />
        <span>{vaultName}</span>
      </button>
      {open && (
        <div className="vault-switcher-menu" role="menu">
          <button type="button" className="vault-switcher-current" role="menuitem" onClick={() => setOpen(false)}>
            <span>{vaultName}</span>
            <Check size={16} strokeWidth={1.75} />
          </button>
          <div className="vault-switcher-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenAnother();
            }}
          >
            <FolderCog size={16} strokeWidth={1.75} />
            <span>{t("sidebar.openAnotherVault")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

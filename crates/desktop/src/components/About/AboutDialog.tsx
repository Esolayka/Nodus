import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { FlaskConical, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ensureSandboxVault } from "../../api/vault";
import { useVaultStore } from "../../store/vaultStore";
import "./AboutDialog.css";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [openingSandbox, setOpeningSandbox] = useState(false);
  const openVault = useVaultStore((s) => s.open);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function openSandbox() {
    setOpeningSandbox(true);
    try {
      const path = await ensureSandboxVault();
      await openVault(path);
      onClose();
    } finally {
      setOpeningSandbox(false);
    }
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="about-overlay"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="about-modal" role="dialog" aria-modal="true">
        <button
          type="button"
          className="about-close"
          aria-label={t("settings.close")}
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.75} />
        </button>

        <div className="about-header">
          <img src="/nodus-logo.png" alt="" className="about-logo" />
          <h2 className="about-title">Nodus</h2>
          <div className="about-version">
            {version ? t("about.version", { version }) : ""}
          </div>
        </div>

        <div className="about-card">
          <div className="about-row">
            <span className="about-row-icon">
              <FlaskConical size={20} strokeWidth={1.5} />
            </span>
            <div className="about-row-text">
              <div className="about-row-label">{t("about.sandboxTitle")}</div>
              <div className="about-row-desc">{t("about.sandboxDesc")}</div>
            </div>
            <button
              type="button"
              className="about-row-btn"
              disabled={openingSandbox}
              onClick={() => void openSandbox()}
            >
              {t("about.sandboxOpen")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

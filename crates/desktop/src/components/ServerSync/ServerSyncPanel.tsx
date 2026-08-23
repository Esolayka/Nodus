import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerSyncStore } from "../../store/serverSyncStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useVaultStore } from "../../store/vaultStore";
import "./ServerSyncPanel.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ServerSyncPanel() {
  const { t } = useTranslation();
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const status = useServerSyncStore((s) => s.status);
  const lastError = useServerSyncStore((s) => s.lastError);
  const lastReport = useServerSyncStore((s) => s.lastReport);
  const storageUsage = useServerSyncStore((s) => s.storageUsage);
  const enable = useServerSyncStore((s) => s.enable);
  const syncOnce = useServerSyncStore((s) => s.syncOnce);
  const pairStart = useServerSyncStore((s) => s.pairStart);
  const pairComplete = useServerSyncStore((s) => s.pairComplete);

  const server = settings.sync.server;
  const setServer = (partial: Partial<typeof server>) =>
    setSettings({ sync: { ...settings.sync, server: { ...server, ...partial } } });

  const [baseUrlInput, setBaseUrlInput] = useState(server.baseUrl);
  const [codeInput, setCodeInput] = useState("");
  const [deviceNameInput, setDeviceNameInput] = useState(server.deviceName);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [newDeviceCode, setNewDeviceCode] = useState<{ code: string; expiresAt: number } | null>(null);

  const alreadyPaired = server.token !== "";

  async function handlePair() {
    if (!vaultPath) return;
    setPairing(true);
    setPairError(null);
    try {
      const result = await pairComplete(baseUrlInput.trim(), codeInput.trim(), deviceNameInput.trim());
      setServer({ baseUrl: baseUrlInput.trim(), token: result.token, deviceName: deviceNameInput.trim() });
      await enable(vaultPath, baseUrlInput.trim(), result.token, deviceNameInput.trim());
    } catch (err) {
      setPairError(String(err));
    } finally {
      setPairing(false);
    }
  }

  async function handleGenerateCode() {
    setNewDeviceCode(await pairStart());
  }

  if (!vaultPath) return null;

  if (!alreadyPaired) {
    return (
      <div className="server-sync-panel">
        <p className="side-panel-empty">{t("serverSync.notPaired")}</p>
        <div className="server-sync-pair-form">
          <input
            className="field"
            placeholder={t("serverSync.baseUrlPlaceholder")}
            value={baseUrlInput}
            onChange={(e) => setBaseUrlInput(e.target.value)}
          />
          <input
            className="field"
            placeholder={t("serverSync.codePlaceholder")}
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase" }}
          />
          <input
            className="field"
            placeholder={t("serverSync.deviceNamePlaceholder")}
            value={deviceNameInput}
            onChange={(e) => setDeviceNameInput(e.target.value)}
          />
          <button
            type="button"
            className="btn-accent"
            disabled={pairing || !baseUrlInput.trim() || !codeInput.trim() || !deviceNameInput.trim()}
            onClick={() => void handlePair()}
          >
            {pairing ? t("serverSync.pairing") : t("serverSync.connect")}
          </button>
          {pairError && <p className="git-error">{pairError}</p>}
        </div>
      </div>
    );
  }

  const busy = status === "syncing";
  const quotaFraction =
    storageUsage?.maxBytes != null && storageUsage.maxBytes > 0 ? storageUsage.usedBytes / storageUsage.maxBytes : null;

  return (
    <div className="server-sync-panel">
      {lastError && status === "error" && <p className="git-error">{lastError}</p>}

      <div className="server-sync-section">
        <button type="button" className="btn-accent" disabled={busy} onClick={() => void syncOnce()}>
          {busy ? t("serverSync.syncing") : t("serverSync.syncNow")}
        </button>
        {lastReport && (
          <p className="server-sync-summary">
            {t("serverSync.lastSync", {
              uploaded: lastReport.uploaded.length,
              downloaded: lastReport.downloaded.length,
            })}
          </p>
        )}
      </div>

      {storageUsage && (
        <div className="server-sync-section">
          <h3 className="git-section-title">{t("serverSync.storage")}</h3>
          <div className="server-sync-quota-bar">
            <div
              className="server-sync-quota-fill"
              style={{ width: quotaFraction != null ? `${Math.min(100, quotaFraction * 100)}%` : "100%" }}
            />
          </div>
          <p className="server-sync-summary">
            {formatBytes(storageUsage.usedBytes)}
            {storageUsage.maxBytes != null ? ` / ${formatBytes(storageUsage.maxBytes)}` : ""}
          </p>
        </div>
      )}

      <div className="server-sync-section">
        <h3 className="git-section-title">{t("serverSync.addDevice")}</h3>
        <button type="button" onClick={() => void handleGenerateCode()}>
          {t("serverSync.generateCode")}
        </button>
        {newDeviceCode && (
          <p className="server-sync-code">
            {newDeviceCode.code}
            <span className="server-sync-code-hint">{t("serverSync.codeHint")}</span>
          </p>
        )}
      </div>
    </div>
  );
}

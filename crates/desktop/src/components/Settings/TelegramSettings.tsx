import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { useSettingsStore } from "../../store/settingsStore";
import type { TelegramStatus } from "../../types/vault";
import { Toggle } from "../ui/Toggle";

function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-desc">{description}</div>
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

export function TelegramSettings() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const telegram = settings.telegram;
  const setTelegram = (partial: Partial<typeof telegram>) => setSettings({ telegram: { ...telegram, ...partial } });

  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [code, setCode] = useState<{ token: string; expiresAt: number } | null>(null);
  const [tunnelStarting, setTunnelStarting] = useState(false);

  const refreshStatus = () => {
    void api.telegramStatus().then(setStatus);
  };

  useEffect(() => {
    if (telegram.enabled && telegram.placement === "local") refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegram.enabled, telegram.placement]);

  async function handleGenerateCode() {
    setCode(await api.telegramGenerateLinkCode());
  }

  async function handleStartTunnel() {
    setTunnelStarting(true);
    try {
      await api.telegramStartTunnel();
    } finally {
      setTunnelStarting(false);
      refreshStatus();
    }
  }

  return (
    <>
      <div className="settings-card">
        <SettingRow
          label={t("settings.telegram.enabled")}
          description={t("settings.telegram.enabledDesc")}
          control={
            <Toggle
              checked={telegram.enabled}
              onChange={(enabled) => setTelegram({ enabled })}
              ariaLabel={t("settings.telegram.enabled")}
            />
          }
        />
        {telegram.enabled && (
          <SettingRow
            label={t("settings.telegram.placement")}
            description={t("settings.telegram.placementDesc")}
            control={
              <div className="settings-segmented">
                {(["local", "server"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={telegram.placement === mode ? "active" : ""}
                    onClick={() => setTelegram({ placement: mode })}
                  >
                    {t(`settings.telegram.placement_${mode}`)}
                  </button>
                ))}
              </div>
            }
          />
        )}
      </div>

      {telegram.enabled && telegram.placement === "server" && (
        <p className="settings-warning">{t("settings.telegram.serverPlacementNote")}</p>
      )}

      {telegram.enabled && telegram.placement === "local" && (
        <>
          <h3 className="settings-card-label">{t("settings.telegram.localTitle")}</h3>
          <div className="settings-card">
            <SettingRow
              label={t("settings.telegram.botToken")}
              description={t("settings.telegram.botTokenDesc")}
              control={
                <input
                  className="field"
                  type="password"
                  style={{ width: 260, fontFamily: "var(--font-mono)" }}
                  value={telegram.botToken}
                  onChange={(e) => setTelegram({ botToken: e.target.value })}
                  placeholder="123456789:AAbecomeAvalidTokenHere"
                />
              }
            />
            <SettingRow
              label={t("settings.telegram.manualAddress")}
              description={t("settings.telegram.manualAddressDesc")}
              control={
                <input
                  className="field"
                  style={{ width: 260 }}
                  value={telegram.manualAddress}
                  onChange={(e) => setTelegram({ manualAddress: e.target.value })}
                  placeholder="https://my-tunnel.example.com"
                />
              }
            />
          </div>

          <h3 className="settings-card-label">{t("settings.telegram.linkTitle")}</h3>
          <div className="settings-card">
            <SettingRow
              label={t("settings.telegram.generateCode")}
              description={t("settings.telegram.generateCodeDesc")}
              control={
                <button type="button" onClick={() => void handleGenerateCode()}>
                  {t("settings.telegram.generateCode")}
                </button>
              }
            />
            {code && (
              <div className="settings-row" style={{ display: "block" }}>
                <p className="server-sync-code">{code.token}</p>
                <p className="server-sync-summary">{t("settings.telegram.codeHint")}</p>
              </div>
            )}
            <SettingRow
              label={t("settings.telegram.startTunnel")}
              description={t("settings.telegram.startTunnelDesc")}
              control={
                <button type="button" disabled={tunnelStarting} onClick={() => void handleStartTunnel()}>
                  {tunnelStarting ? t("settings.telegram.startingTunnel") : t("settings.telegram.startTunnel")}
                </button>
              }
            />
          </div>

          {status && (
            <>
              <h3 className="settings-card-label">{t("settings.telegram.statusTitle")}</h3>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.telegram.botConfigured")}
                  description=""
                  control={<span>{status.botConfigured ? t("settings.telegram.yes") : t("settings.telegram.no")}</span>}
                />
                <SettingRow
                  label={t("settings.telegram.publicAddress")}
                  description=""
                  control={<span>{status.publicAddress ?? t("settings.telegram.notAvailable")}</span>}
                />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

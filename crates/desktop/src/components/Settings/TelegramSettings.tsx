import { useEffect, useState } from "react";
import { Check, Laptop, Power, Server } from "lucide-react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { fetchTelegramStartLink } from "../../lib/telegramBot";
import { useSettingsStore, type TelegramPlacement } from "../../store/settingsStore";
import type { TelegramStatus } from "../../types/vault";
import "./ConnectionSettings.css";
import "./TelegramSettings.css";

type TelegramMode = TelegramPlacement | "off";

function ModeCard({
  icon,
  title,
  description,
  selected,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`connection-method${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="connection-method-icon">{icon}</span>
      <span className="connection-method-copy">
        <span className="connection-method-title">
          {title}
          {badge && <span className="connection-method-badge">{badge}</span>}
        </span>
        <span className="connection-method-description">{description}</span>
      </span>
      <span className="connection-method-check">{selected && <Check size={15} />}</span>
    </button>
  );
}

async function waitForPublicAddress(timeoutMessage: string): Promise<TelegramStatus> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await api.telegramStatus();
    if (status.publicAddress) return status;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error(timeoutMessage);
}

export function TelegramSettings() {
  const { t } = useTranslation();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const telegram = settings.telegram;
  const mode: TelegramMode = telegram.enabled ? telegram.placement : "off";
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [code, setCode] = useState<{ token: string; expiresAt: number } | null>(null);
  const [startLink, setStartLink] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const setTelegram = (partial: Partial<typeof telegram>) =>
    setSettings({ telegram: { ...telegram, ...partial } });

  useEffect(() => {
    if (mode !== "local") {
      setStatus(null);
      return;
    }
    void api.telegramStatus().then(setStatus).catch(() => setStatus(null));
  }, [mode]);

  function selectMode(nextMode: TelegramMode) {
    setSetupError(null);
    setCode(null);
    setStartLink(null);
    if (nextMode === "off") {
      setTelegram({ enabled: false });
    } else {
      setTelegram({ enabled: true, placement: nextMode });
    }
  }

  async function handleSetup() {
    const token = telegram.botToken.trim();
    if (!token) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      await api.telegramSetBotToken(token);

      let nextStatus: TelegramStatus;
      const manualAddress = telegram.manualAddress.trim();
      if (manualAddress) {
        await api.telegramSetManualAddress(manualAddress);
        nextStatus = await api.telegramStatus();
      } else {
        const currentStatus = await api.telegramStatus();
        if (currentStatus.publicAddress) {
          nextStatus = currentStatus;
        } else {
          await api.telegramStartTunnel();
          nextStatus = await waitForPublicAddress(t("settings.telegram.tunnelTimeout"));
        }
      }
      setStatus(nextStatus);

      const generated = await api.telegramGenerateLinkCode();
      const link = await fetchTelegramStartLink(token, generated.token);
      if (!link) throw new Error(t("settings.telegram.invalidToken"));
      setCode(generated);
      setStartLink(link);
      await openShell(link);
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function handleCopyStartLink() {
    if (startLink) await navigator.clipboard.writeText(startLink);
  }

  return (
    <>
      <p className="connection-intro">{t("settings.telegram.simpleIntro")}</p>
      <div className="connection-methods">
        <ModeCard
          icon={<Laptop size={18} />}
          title={t("settings.telegram.placement_local")}
          description={t("settings.telegram.localSimpleDesc")}
          badge={t("settings.telegram.easy")}
          selected={mode === "local"}
          onClick={() => selectMode("local")}
        />
        <ModeCard
          icon={<Server size={18} />}
          title={t("settings.telegram.placement_server")}
          description={t("settings.telegram.serverSimpleDesc")}
          selected={mode === "server"}
          onClick={() => selectMode("server")}
        />
        <ModeCard
          icon={<Power size={18} />}
          title={t("settings.telegram.off")}
          description={t("settings.telegram.offDesc")}
          selected={mode === "off"}
          onClick={() => selectMode("off")}
        />
      </div>

      {mode === "server" && (
        <div className="connection-setup-card telegram-server-note">
          <strong>{t("settings.telegram.serverReadyTitle")}</strong>
          <p>{t("settings.telegram.serverPlacementNote")}</p>
        </div>
      )}

      {mode === "local" && (
        <div className="connection-setup-card">
          <div className="connection-setup-heading">
            <span className="connection-step">1</span>
            <div>
              <strong>{t("settings.telegram.connectTitle")}</strong>
              <span>{t("settings.telegram.connectDesc")}</span>
            </div>
          </div>

          <label className="connection-field">
            <span className="connection-field-label">{t("settings.telegram.botToken")}</span>
            <input
              className="field telegram-token-input"
              type="password"
              value={telegram.botToken}
              onChange={(event) => setTelegram({ botToken: event.target.value })}
              placeholder="123456789:AA..."
              autoComplete="off"
            />
            <span className="connection-field-hint">{t("settings.telegram.botTokenSimpleDesc")}</span>
          </label>

          <button
            type="button"
            className="btn-accent connection-primary-action telegram-connect-button"
            disabled={setupBusy || !telegram.botToken.trim()}
            onClick={() => void handleSetup()}
          >
            {setupBusy ? t("settings.telegram.connecting") : t("settings.telegram.connect")}
          </button>
          <p className="telegram-connect-hint">{t("settings.telegram.connectHint")}</p>

          {startLink && code && (
            <div className="telegram-link-result">
              <div className="connection-connected">
                <span className="connection-status-dot online" />
                <div>
                  <strong>{t("settings.telegram.linkReady")}</strong>
                  <span>{t("settings.telegram.codeFallback", { code: code.token })}</span>
                </div>
              </div>
              <div className="telegram-start-link-row">
                <button type="button" className="btn-accent" onClick={() => void openShell(startLink)}>
                  {t("settings.telegram.openLink")}
                </button>
                <button type="button" onClick={() => void handleCopyStartLink()}>
                  {t("settings.telegram.copyLink")}
                </button>
              </div>
            </div>
          )}

          {status?.publicAddress && !startLink && (
            <div className="connection-connected telegram-current-status">
              <span className="connection-status-dot online" />
              <div>
                <strong>{t("settings.telegram.tunnelReady")}</strong>
                <span>{status.publicAddress}</span>
              </div>
            </div>
          )}

          <details className="connection-advanced">
            <summary>{t("settings.sync.advanced")}</summary>
            <div className="connection-advanced-content">
              <label className="connection-field">
                <span className="connection-field-label">{t("settings.telegram.manualAddress")}</span>
                <input
                  className="field"
                  value={telegram.manualAddress}
                  onChange={(event) => setTelegram({ manualAddress: event.target.value })}
                  placeholder="https://my-tunnel.example.com"
                />
                <span className="connection-field-hint">{t("settings.telegram.manualAddressDesc")}</span>
              </label>
            </div>
          </details>
        </div>
      )}

      {setupError && <p className="connection-error">{setupError}</p>}
    </>
  );
}

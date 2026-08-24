import { useState } from "react";
import { Check, GitBranch, Power, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useServerSyncStore } from "../../store/serverSyncStore";
import { useSettingsStore, type SyncMechanism } from "../../store/settingsStore";
import { useSyncStore } from "../../store/syncStore";
import { useVaultStore } from "../../store/vaultStore";
import { Toggle } from "../ui/Toggle";
import "./ConnectionSettings.css";

type AvailableMechanism = Exclude<SyncMechanism, "cloud">;

function MethodCard({
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="connection-field">
      <span className="connection-field-label">{label}</span>
      {children}
      {hint && <span className="connection-field-hint">{hint}</span>}
    </label>
  );
}

export function SyncSettings() {
  const { t } = useTranslation();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const vaultPath = useVaultStore((state) => state.vaultPath);
  const serverEnabled = useServerSyncStore((state) => state.enabled);
  const serverStatus = useServerSyncStore((state) => state.status);
  const serverStoreError = useServerSyncStore((state) => state.lastError);
  const pairComplete = useServerSyncStore((state) => state.pairComplete);
  const enableServer = useServerSyncStore((state) => state.enable);
  const gitEnabled = useSyncStore((state) => state.enabled);
  const gitStatus = useSyncStore((state) => state.status);
  const gitStoreError = useSyncStore((state) => state.lastError);
  const enableGit = useSyncStore((state) => state.enableGit);
  const addRemote = useSyncStore((state) => state.addRemote);

  const server = settings.sync.server;
  const git = settings.sync.git;
  const [serverUrl, setServerUrl] = useState(server.baseUrl);
  const [pairCode, setPairCode] = useState("");
  const [deviceName, setDeviceName] = useState(server.deviceName);
  const [gitUrl, setGitUrl] = useState(git.remoteUrl);
  const [busy, setBusy] = useState<"server" | "git" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setMechanism = (mechanism: AvailableMechanism) => {
    setError(null);
    setSettings({ sync: { ...settings.sync, mechanism } });
  };
  const setServer = (partial: Partial<typeof server>) =>
    setSettings({ sync: { ...settings.sync, server: { ...server, ...partial } } });
  const setGit = (partial: Partial<typeof git>) =>
    setSettings({ sync: { ...settings.sync, git: { ...git, ...partial } } });

  async function connectServer() {
    if (!vaultPath) return;
    setBusy("server");
    setError(null);
    try {
      const baseUrl = serverUrl.trim().replace(/\/$/, "");
      const name = deviceName.trim();
      const result = await pairComplete(baseUrl, pairCode.trim(), name);
      setSettings({
        sync: {
          ...settings.sync,
          mechanism: "server",
          server: { ...server, baseUrl, token: result.token, deviceName: name },
        },
      });
      await enableServer(vaultPath, baseUrl, result.token, name);
    } catch (connectError) {
      setError(String(connectError));
    } finally {
      setBusy(null);
    }
  }

  async function connectGit() {
    if (!vaultPath) return;
    setBusy("git");
    setError(null);
    const remoteUrl = gitUrl.trim();
    setSettings({
      sync: {
        ...settings.sync,
        mechanism: "git",
        git: { ...git, remoteUrl },
      },
    });
    await enableGit(vaultPath);
    if (remoteUrl) await addRemote(git.remoteName, remoteUrl);
    setBusy(null);
  }

  const activeError = error
    ?? (settings.sync.mechanism === "server" ? serverStoreError : null)
    ?? (settings.sync.mechanism === "git" ? gitStoreError : null);

  return (
    <>
      <p className="connection-intro">{t("settings.sync.simpleIntro")}</p>
      <div className="connection-methods">
        <MethodCard
          icon={<Server size={18} />}
          title={t("settings.sync.mechanism_server")}
          description={t("settings.sync.server.simpleDesc")}
          badge={t("settings.sync.recommended")}
          selected={settings.sync.mechanism === "server"}
          onClick={() => setMechanism("server")}
        />
        <MethodCard
          icon={<GitBranch size={18} />}
          title={t("settings.sync.mechanism_git")}
          description={t("settings.sync.git.simpleDesc")}
          selected={settings.sync.mechanism === "git"}
          onClick={() => setMechanism("git")}
        />
        <MethodCard
          icon={<Power size={18} />}
          title={t("settings.sync.mechanism_none")}
          description={t("settings.sync.offDesc")}
          selected={settings.sync.mechanism === "none"}
          onClick={() => setMechanism("none")}
        />
      </div>

      {settings.sync.mechanism === "server" && (
        <div className="connection-setup-card">
          {server.token ? (
            <div className="connection-connected">
              <span className={`connection-status-dot${serverEnabled ? " online" : ""}`} />
              <div>
                <strong>
                  {serverEnabled
                    ? t("settings.sync.connected")
                    : serverStatus === "error"
                      ? t("settings.sync.connectionFailed")
                      : t("settings.sync.connecting")}
                </strong>
                <span>{server.baseUrl}</span>
              </div>
              <button
                type="button"
                className="connection-change-button"
                onClick={() => setServer({ token: "" })}
              >
                {t("settings.sync.changeConnection")}
              </button>
            </div>
          ) : (
            <>
              <div className="connection-setup-heading">
                <span className="connection-step">1</span>
                <div>
                  <strong>{t("settings.sync.server.connectTitle")}</strong>
                  <span>{t("settings.sync.server.connectDesc")}</span>
                </div>
              </div>
              <div className="connection-form-grid">
                <Field label={t("settings.sync.server.baseUrl")}>
                  <input
                    className="field"
                    value={serverUrl}
                    onChange={(event) => setServerUrl(event.target.value)}
                    placeholder="https://sync.example.com"
                  />
                </Field>
                <Field label={t("settings.sync.server.pairCode")} hint={t("settings.sync.server.pairCodeHint")}>
                  <input
                    className="field connection-code-input"
                    value={pairCode}
                    onChange={(event) => setPairCode(event.target.value.toUpperCase())}
                    placeholder="ABCD-EFGH"
                  />
                </Field>
                <Field label={t("settings.sync.server.deviceName")}>
                  <input
                    className="field"
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                  />
                </Field>
              </div>
              <button
                type="button"
                className="btn-accent connection-primary-action"
                disabled={busy !== null || !serverUrl.trim() || !pairCode.trim() || !deviceName.trim()}
                onClick={() => void connectServer()}
              >
                {busy === "server" ? t("settings.sync.server.connecting") : t("settings.sync.server.connect")}
              </button>
            </>
          )}

          <details className="connection-advanced">
            <summary>{t("settings.sync.advanced")}</summary>
            <div className="connection-advanced-content">
              {server.token && (
                <Field label={t("settings.sync.server.deviceName")}>
                  <input
                    className="field"
                    value={server.deviceName}
                    onChange={(event) => setServer({ deviceName: event.target.value })}
                  />
                </Field>
              )}
              <div className="connection-inline-setting">
                <div>
                  <strong>{t("settings.sync.server.autoSync")}</strong>
                  <span>{t("settings.sync.server.autoSyncDesc")}</span>
                </div>
                <Toggle
                  checked={server.autoSync === "scheduled"}
                  onChange={(enabled) => setServer({ autoSync: enabled ? "scheduled" : "manual" })}
                  ariaLabel={t("settings.sync.server.autoSync")}
                />
              </div>
              {server.autoSync === "scheduled" && (
                <Field label={t("settings.sync.server.autoSyncInterval")}>
                  <input
                    className="field connection-number-input"
                    type="number"
                    min={5}
                    max={180}
                    step={5}
                    value={server.autoSyncIntervalMinutes}
                    onChange={(event) => setServer({ autoSyncIntervalMinutes: Number(event.target.value) })}
                  />
                </Field>
              )}
            </div>
          </details>
        </div>
      )}

      {settings.sync.mechanism === "git" && (
        <div className="connection-setup-card">
          <p className="connection-warning">{t("settings.sync.gitEncryptionWarning")}</p>
          <div className="connection-setup-heading">
            <span className="connection-step">1</span>
            <div>
              <strong>{t("settings.sync.git.connectTitle")}</strong>
              <span>{t("settings.sync.git.connectDesc")}</span>
            </div>
          </div>
          <Field label={t("settings.sync.git.remoteUrl")} hint={t("settings.sync.git.remoteOptionalHint")}>
            <input
              className="field"
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
              placeholder="https://github.com/user/notes.git"
            />
          </Field>
          <button
            type="button"
            className="btn-accent connection-primary-action"
            disabled={busy !== null || gitStatus === "syncing"}
            onClick={() => void connectGit()}
          >
            {busy === "git"
              ? t("settings.sync.git.connecting")
              : gitEnabled
                ? t("settings.sync.git.saveRemote")
                : t("settings.sync.git.connect")}
          </button>

          <details className="connection-advanced">
            <summary>{t("settings.sync.advanced")}</summary>
            <div className="connection-advanced-content">
              <div className="connection-form-grid">
                <Field label={t("settings.sync.git.remoteName")}>
                  <input className="field" value={git.remoteName} onChange={(event) => setGit({ remoteName: event.target.value })} />
                </Field>
                <Field label={t("settings.sync.git.branch")}>
                  <input className="field" value={git.branch} onChange={(event) => setGit({ branch: event.target.value })} />
                </Field>
                <Field label={t("settings.sync.git.authorName")}>
                  <input className="field" value={git.authorName} onChange={(event) => setGit({ authorName: event.target.value })} />
                </Field>
                <Field label={t("settings.sync.git.authorEmail")}>
                  <input className="field" value={git.authorEmail} onChange={(event) => setGit({ authorEmail: event.target.value })} />
                </Field>
              </div>
              <div className="connection-inline-setting">
                <div>
                  <strong>{t("settings.sync.git.autopullOnStartup")}</strong>
                  <span>{t("settings.sync.git.autopullOnStartupDesc")}</span>
                </div>
                <Toggle
                  checked={git.autopullOnStartup}
                  onChange={(autopullOnStartup) => setGit({ autopullOnStartup })}
                  ariaLabel={t("settings.sync.git.autopullOnStartup")}
                />
              </div>
              <div className="connection-inline-setting">
                <div>
                  <strong>{t("settings.sync.git.autocommit")}</strong>
                  <span>{t("settings.sync.git.autocommitDesc")}</span>
                </div>
                <div className="settings-segmented">
                  {(["off", "manual", "scheduled"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={git.autocommit === mode ? "active" : ""}
                      onClick={() => setGit({ autocommit: mode })}
                    >
                      {t(`settings.sync.git.autocommit_${mode}`)}
                    </button>
                  ))}
                </div>
              </div>
              {git.autocommit === "scheduled" && (
                <Field label={t("settings.sync.git.autocommitInterval")}>
                  <input
                    className="field connection-number-input"
                    type="number"
                    min={5}
                    max={180}
                    step={5}
                    value={git.autocommitIntervalMinutes}
                    onChange={(event) => setGit({ autocommitIntervalMinutes: Number(event.target.value) })}
                  />
                </Field>
              )}
              <Field label={t("settings.sync.git.commitMessageTemplate")}>
                <input
                  className="field"
                  value={git.commitMessageTemplate}
                  onChange={(event) => setGit({ commitMessageTemplate: event.target.value })}
                />
              </Field>
            </div>
          </details>
        </div>
      )}

      {activeError && <p className="connection-error">{activeError}</p>}
      {settings.sync.mechanism === "server" && serverStatus === "syncing" && (
        <p className="connection-progress">{t("serverSync.syncing")}</p>
      )}
    </>
  );
}

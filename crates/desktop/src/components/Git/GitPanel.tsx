import { useEffect, useState } from "react";
import { FilePlus2, FilePenLine, Trash2, ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../store/settingsStore";
import { useSyncStore } from "../../store/syncStore";
import { useVaultStore } from "../../store/vaultStore";
import type { FileChangeKind } from "../../types/vault";
import { ConflictDialog } from "./ConflictDialog";
import "./GitPanel.css";

function KindIcon({ kind }: { kind: FileChangeKind }) {
  if (kind === "added") return <FilePlus2 size={12} />;
  if (kind === "modified") return <FilePenLine size={12} />;
  if (kind === "deleted") return <Trash2 size={12} />;
  return <ArrowLeftRight size={12} />;
}

export function GitPanel() {
  const { t } = useTranslation();
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const enabled = useSyncStore((s) => s.enabled);
  const status = useSyncStore((s) => s.status);
  const lastError = useSyncStore((s) => s.lastError);
  const changes = useSyncStore((s) => s.changes);
  const conflictPaths = useSyncStore((s) => s.conflictPaths);
  const credentials = useSyncStore((s) => s.credentials);
  const setCredentials = useSyncStore((s) => s.setCredentials);
  const enableGit = useSyncStore((s) => s.enableGit);
  const refreshStatus = useSyncStore((s) => s.refreshStatus);
  const commit = useSyncStore((s) => s.commit);
  const addRemote = useSyncStore((s) => s.addRemote);
  const pull = useSyncStore((s) => s.pull);
  const push = useSyncStore((s) => s.push);

  const [message, setMessage] = useState("");
  const [showConflicts, setShowConflicts] = useState(false);

  const git = settings.sync.git;
  const setGit = (partial: Partial<typeof git>) =>
    setSettings({ sync: { ...settings.sync, git: { ...git, ...partial } } });

  useEffect(() => {
    if (enabled) void refreshStatus();
  }, [enabled, refreshStatus]);

  useEffect(() => {
    if (conflictPaths.length > 0) setShowConflicts(true);
  }, [conflictPaths.length]);

  const busy = status === "syncing";

  async function handleEnable() {
    if (!vaultPath) return;
    setSettings({ sync: { ...settings.sync, mechanism: "git" } });
    await enableGit(vaultPath);
  }

  async function handleCommit() {
    const authorName = git.authorName || "Nodus";
    const authorEmail = git.authorEmail || "nodus@localhost";
    const text = message.trim() || git.commitMessageTemplate.replace("%date%", new Date().toLocaleString());
    await commit(text, authorName, authorEmail);
    setMessage("");
  }

  if (!vaultPath) return null;

  if (!enabled) {
    return (
      <div className="git-panel">
        <p className="side-panel-empty">{t("git.notEnabled")}</p>
        <button type="button" className="btn-accent" onClick={() => void handleEnable()}>
          {t("settings.sync.git.enable")}
        </button>
      </div>
    );
  }

  return (
    <div className="git-panel">
      {conflictPaths.length > 0 && (
        <div className="git-conflict-banner">
          <span>{t("git.conflictBanner", { count: conflictPaths.length })}</span>
          <button type="button" onClick={() => setShowConflicts(true)}>
            {t("git.resolveConflicts")}
          </button>
        </div>
      )}
      {lastError && status === "error" && <p className="git-error">{lastError}</p>}

      <div className="git-section">
        <h3 className="git-section-title">{t("git.changes")}</h3>
        {changes.length === 0 ? (
          <p className="side-panel-empty">{t("git.noChanges")}</p>
        ) : (
          <ul className="git-changes-list">
            {changes.map((change) => (
              <li key={change.path} className="git-change-row">
                <span className={`git-change-kind git-change-kind-${change.kind}`}>
                  <KindIcon kind={change.kind} />
                </span>
                <span className="git-change-path">{change.path}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="field git-commit-input"
          placeholder={t("git.commitPlaceholder")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
        />
        <button
          type="button"
          className="btn-accent"
          disabled={busy || changes.length === 0}
          onClick={() => void handleCommit()}
        >
          {busy ? t("git.committing") : t("git.commit")}
        </button>
      </div>

      <div className="git-section">
        <div className="git-actions-row">
          <button
            type="button"
            disabled={busy || !git.remoteUrl}
            onClick={() => void pull(git.remoteName, git.branch)}
          >
            {status === "syncing" ? t("git.pulling") : t("git.pull")}
          </button>
          <button
            type="button"
            disabled={busy || !git.remoteUrl}
            onClick={() => void push(git.remoteName, git.branch)}
          >
            {status === "syncing" ? t("git.pushing") : t("git.push")}
          </button>
        </div>
      </div>

      <div className="git-section">
        <h3 className="git-section-title">{t("git.remoteSetupTitle")}</h3>
        <input
          className="field"
          placeholder="https://example.com/vault.git"
          value={git.remoteUrl}
          onChange={(e) => setGit({ remoteUrl: e.target.value })}
        />
        <button
          type="button"
          disabled={!git.remoteUrl}
          onClick={() => void addRemote(git.remoteName, git.remoteUrl)}
        >
          {t("git.addRemote")}
        </button>

        <h3 className="git-section-title">{t("git.credentialsTitle")}</h3>
        <div className="settings-segmented">
          {(["none", "token", "ssh"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={
                (kind === "none" && credentials.kind === "none") ||
                (kind === "token" && credentials.kind === "userPassToken") ||
                (kind === "ssh" && credentials.kind === "sshKey")
                  ? "active"
                  : ""
              }
              onClick={() =>
                setCredentials(
                  kind === "none"
                    ? { kind: "none" }
                    : kind === "token"
                      ? { kind: "userPassToken", username: "", token: "" }
                      : { kind: "sshKey", privateKeyPath: "", passphrase: null },
                )
              }
            >
              {t(`git.credentials_${kind}`)}
            </button>
          ))}
        </div>
        {credentials.kind === "userPassToken" && (
          <>
            <input
              className="field"
              placeholder={t("git.username")}
              value={credentials.username}
              onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
            />
            <input
              className="field"
              type="password"
              placeholder={t("git.token")}
              value={credentials.token}
              onChange={(e) => setCredentials({ ...credentials, token: e.target.value })}
            />
          </>
        )}
        {credentials.kind === "sshKey" && (
          <>
            <input
              className="field"
              placeholder={t("git.sshKeyPath")}
              value={credentials.privateKeyPath}
              onChange={(e) => setCredentials({ ...credentials, privateKeyPath: e.target.value })}
            />
            <input
              className="field"
              type="password"
              placeholder={t("git.sshPassphrase")}
              value={credentials.passphrase ?? ""}
              onChange={(e) => setCredentials({ ...credentials, passphrase: e.target.value || null })}
            />
          </>
        )}
      </div>

      {showConflicts && conflictPaths.length > 0 && (
        <ConflictDialog paths={conflictPaths} branch={git.branch} onClose={() => setShowConflicts(false)} />
      )}
    </div>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useOpenVaultFolder } from "../../hooks/useOpenVaultFolder";
import { ObsidianImportDialog } from "../Import/ObsidianImportDialog";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../../i18n";
import {
  getCommand,
  getCommandsSnapshot,
  subscribeCommands,
  type Command,
} from "../../lib/commandRegistry";
import { findConflict, keysForCommand, labelForKeys, normalizeKeyEvent } from "../../lib/hotkeyRegistry";
import { ALL_PLUGINS, type NodusPlugin } from "../../plugins";
import { pluginHost } from "../../plugins/host";
import {
  DEFAULT_SETTINGS,
  useSettingsStore,
  type GraphColors,
  type ThemePreference,
} from "../../store/settingsStore";
import { useVaultStore } from "../../store/vaultStore";
import { TelegramSettings } from "./TelegramSettings";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import "./SettingsModal.css";

type Section =
  | "general"
  | "editor"
  | "graph"
  | "hotkeys"
  | "vault"
  | "dailyNotes"
  | "templates"
  | "tasks"
  | "history"
  | "attachments"
  | "sync"
  | "telegram"
  | "plugins";

const COLOR_FIELDS: { key: keyof GraphColors; labelKey: string; descKey: string }[] = [
  { key: "background", labelKey: "settings.graph.colors_background", descKey: "settings.graph.colors_backgroundDesc" },
  { key: "link", labelKey: "settings.graph.colors_link", descKey: "settings.graph.colors_linkDesc" },
  { key: "node", labelKey: "settings.graph.colors_node", descKey: "settings.graph.colors_nodeDesc" },
  { key: "accent", labelKey: "settings.graph.colors_accent", descKey: "settings.graph.colors_accentDesc" },
];

const COLOR_VARS: Record<keyof GraphColors, string> = {
  background: "--bg-primary",
  link: "--graph-edge",
  node: "--graph-node",
  accent: "--accent",
};

function cssColor(varName: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value.startsWith("#") ? value : "#a3a3a3";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="settings-section-title">{children}</h2>;
}

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

function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="settings-row-value">{value}</span>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const { openFolder, obsidianImport, closeObsidianImport, open } = useOpenVaultFolder();
  const [section, setSection] = useState<Section>("general");
  const [query, setQuery] = useState("");
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setTheme = (theme: ThemePreference) => setSettings({ theme });
  const setLanguage = (language: SupportedLanguage) => setSettings({ language });
  const setEditor = (partial: Partial<typeof settings.editor>) =>
    setSettings({ editor: { ...settings.editor, ...partial } });
  const setGraph = (partial: Partial<typeof settings.graph>) =>
    setSettings({ graph: { ...settings.graph, ...partial } });
  const setDailyNotes = (partial: Partial<typeof settings.dailyNotes>) =>
    setSettings({ dailyNotes: { ...settings.dailyNotes, ...partial } });
  const setTemplates = (partial: Partial<typeof settings.templates>) =>
    setSettings({ templates: { ...settings.templates, ...partial } });
  const setTasksSettings = (partial: Partial<typeof settings.tasks>) =>
    setSettings({ tasks: { ...settings.tasks, ...partial } });
  const setHistory = (partial: Partial<typeof settings.history>) =>
    setSettings({ history: { ...settings.history, ...partial } });
  const setAttachments = (partial: Partial<typeof settings.attachments>) =>
    setSettings({ attachments: { ...settings.attachments, ...partial } });
  const setSyncMechanism = (mechanism: (typeof settings.sync)["mechanism"]) =>
    setSettings({ sync: { ...settings.sync, mechanism } });
  const setSyncGit = (partial: Partial<typeof settings.sync.git>) =>
    setSettings({ sync: { ...settings.sync, git: { ...settings.sync.git, ...partial } } });
  const setSyncServer = (partial: Partial<typeof settings.sync.server>) =>
    setSettings({ sync: { ...settings.sync, server: { ...settings.sync.server, ...partial } } });

  const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: t("settings.sections.general"), icon: slidersIcon },
    { id: "editor", label: t("settings.sections.editor"), icon: penIcon },
    { id: "graph", label: t("settings.sections.graph"), icon: graphIcon },
    { id: "hotkeys", label: t("settings.sections.hotkeys"), icon: keyIcon },
    { id: "dailyNotes", label: t("settings.sections.dailyNotes"), icon: calendarIcon },
    { id: "templates", label: t("settings.sections.templates"), icon: templateIcon },
    { id: "tasks", label: t("settings.sections.tasks"), icon: tasksIcon },
    { id: "history", label: t("settings.sections.history"), icon: historyIcon },
    { id: "attachments", label: t("settings.sections.attachments"), icon: attachmentIcon },
    { id: "sync", label: t("settings.sections.sync"), icon: syncIcon },
    { id: "telegram", label: t("settings.sections.telegram"), icon: telegramIcon },
    { id: "plugins", label: t("settings.sections.plugins"), icon: pluginsIcon },
    { id: "vault", label: t("settings.sections.vault"), icon: folderIcon },
  ];

  const visibleSections = query.trim()
    ? sections.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()))
    : sections;

  const languageOptions = SUPPORTED_LANGUAGES.map((lang) => ({
    value: lang,
    label: lang === "ru" ? "Русский" : "English",
  }));

  return createPortal(
    <div
      ref={backdropRef}
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true">
        <button
          type="button"
          className="settings-close"
          aria-label={t("settings.close")}
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
        <div className="settings-nav">
          <div className="settings-search-wrap">
            <svg
              className="settings-search-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <circle cx="7" cy="7" r="4.2" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              className="field settings-search"
              placeholder={t("settings.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="settings-group-label">{t("settings.groupLabel")}</div>
          {visibleSections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav-item${section === s.id ? " active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              <span className="settings-nav-icon">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-content">
          {section === "general" && (
            <>
              <SectionTitle>{t("settings.general.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.general.theme")}
                  description={t("settings.general.themeDesc")}
                  control={
                    <div className="settings-segmented">
                      {(["light", "dark", "system"] as ThemePreference[]).map((pref) => (
                        <button
                          key={pref}
                          type="button"
                          className={settings.theme === pref ? "active" : ""}
                          onClick={() => setTheme(pref)}
                        >
                          {t(`settings.general.theme_${pref}`)}
                        </button>
                      ))}
                    </div>
                  }
                />
                <SettingRow
                  label={t("settings.general.language")}
                  description={t("settings.general.languageDesc")}
                  control={
                    <Select
                      ariaLabel={t("settings.general.language")}
                      value={settings.language}
                      options={languageOptions}
                      onChange={(value) => setLanguage(value as SupportedLanguage)}
                    />
                  }
                />
              </div>
            </>
          )}

          {section === "editor" && (
            <>
              <SectionTitle>{t("settings.editor.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.editor.fontSize")}
                  description={t("settings.editor.fontSizeDesc")}
                  control={
                    <Slider
                      value={settings.editor.fontSize}
                      min={11}
                      max={24}
                      onChange={(fontSize) => setEditor({ fontSize })}
                    />
                  }
                />
              </div>
            </>
          )}

          {section === "graph" && (
            <>
              <SectionTitle>{t("settings.graph.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.graph.showLabels")}
                  description={t("settings.graph.showLabelsDesc")}
                  control={
                    <Toggle
                      checked={settings.graph.showLabels}
                      onChange={(showLabels) => setGraph({ showLabels })}
                      ariaLabel={t("settings.graph.showLabels")}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.graph.nodeSize")}
                  description={t("settings.graph.nodeSizeDesc")}
                  control={
                    <Slider
                      value={settings.graph.nodeSize}
                      min={3}
                      max={14}
                      onChange={(nodeSize) => setGraph({ nodeSize })}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.graph.linkDistance")}
                  description={t("settings.graph.linkDistanceDesc")}
                  control={
                    <Slider
                      value={settings.graph.linkDistance}
                      min={40}
                      max={200}
                      step={5}
                      onChange={(linkDistance) => setGraph({ linkDistance })}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.graph.repulsion")}
                  description={t("settings.graph.repulsionDesc")}
                  control={
                    <Slider
                      value={settings.graph.repulsion}
                      min={200}
                      max={2500}
                      step={50}
                      onChange={(repulsion) => setGraph({ repulsion })}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.graph.localDepth")}
                  description={t("settings.graph.localDepthDesc")}
                  control={
                    <Slider
                      value={settings.graph.localDepth}
                      min={1}
                      max={4}
                      onChange={(localDepth) => setGraph({ localDepth })}
                    />
                  }
                />
              </div>

              <h3 className="settings-card-label">{t("settings.graph.colors")}</h3>
              <div className="settings-card">
                {COLOR_FIELDS.map((field) => (
                  <SettingRow
                    key={field.key}
                    label={t(field.labelKey)}
                    description={t(field.descKey)}
                    control={
                      <div className="settings-color-control">
                        <input
                          type="color"
                          value={
                            settings.graph.colors[field.key] ||
                            cssColor(COLOR_VARS[field.key])
                          }
                          onChange={(e) =>
                            setGraph({
                              colors: {
                                ...settings.graph.colors,
                                [field.key]: e.target.value,
                              },
                            })
                          }
                        />
                        {settings.graph.colors[field.key] && (
                          <button
                            type="button"
                            className="settings-reset-btn"
                            onClick={() =>
                              setGraph({
                                colors: {
                                  ...settings.graph.colors,
                                  [field.key]: "",
                                },
                              })
                            }
                          >
                            {t("settings.graph.resetColor")}
                          </button>
                        )}
                      </div>
                    }
                  />
                ))}
              </div>
              <button
                type="button"
                className="settings-reset-all"
                onClick={() => setSettings({ graph: DEFAULT_SETTINGS.graph })}
              >
                {t("settings.graph.resetAll")}
              </button>
            </>
          )}

          {section === "hotkeys" && <HotkeysSection />}

          {section === "dailyNotes" && (
            <>
              <SectionTitle>{t("settings.dailyNotes.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.dailyNotes.folder")}
                  description={t("settings.dailyNotes.folderDesc")}
                  control={
                    <input
                      className="field"
                      style={{ width: 220 }}
                      value={settings.dailyNotes.folder}
                      onChange={(e) => setDailyNotes({ folder: e.target.value })}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.dailyNotes.filenameFormat")}
                  description={t("settings.dailyNotes.filenameFormatDesc")}
                  control={
                    <input
                      className="field"
                      style={{ width: 160, fontFamily: "var(--font-mono)" }}
                      value={settings.dailyNotes.filenameFormat}
                      onChange={(e) => setDailyNotes({ filenameFormat: e.target.value })}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.dailyNotes.templatePath")}
                  description={t("settings.dailyNotes.templatePathDesc")}
                  control={
                    <input
                      className="field"
                      style={{ width: 220 }}
                      value={settings.dailyNotes.templatePath}
                      onChange={(e) => setDailyNotes({ templatePath: e.target.value })}
                      placeholder={t("settings.dailyNotes.templatePathPlaceholder")}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.dailyNotes.openOnStartup")}
                  description={t("settings.dailyNotes.openOnStartupDesc")}
                  control={
                    <Toggle
                      checked={settings.dailyNotes.openOnStartup}
                      onChange={(openOnStartup) => setDailyNotes({ openOnStartup })}
                      ariaLabel={t("settings.dailyNotes.openOnStartup")}
                    />
                  }
                />
              </div>
            </>
          )}

          {section === "templates" && (
            <>
              <SectionTitle>{t("settings.templates.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.templates.folder")}
                  description={t("settings.templates.folderDesc")}
                  control={
                    <input
                      className="field"
                      style={{ width: 220 }}
                      value={settings.templates.folder}
                      onChange={(e) => setTemplates({ folder: e.target.value })}
                    />
                  }
                />
              </div>
            </>
          )}

          {section === "tasks" && (
            <>
              <SectionTitle>{t("settings.tasks.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.tasks.autoCompletionDate")}
                  description={t("settings.tasks.autoCompletionDateDesc")}
                  control={
                    <Toggle
                      checked={settings.tasks.autoCompletionDate}
                      onChange={(autoCompletionDate) => setTasksSettings({ autoCompletionDate })}
                      ariaLabel={t("settings.tasks.autoCompletionDate")}
                    />
                  }
                />
              </div>
            </>
          )}

          {section === "history" && (
            <>
              <SectionTitle>{t("settings.history.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.history.enabled")}
                  description={t("settings.history.enabledDesc")}
                  control={
                    <Toggle
                      checked={settings.history.enabled}
                      onChange={(enabled) => setHistory({ enabled })}
                      ariaLabel={t("settings.history.enabled")}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.history.maxVersionsPerNote")}
                  description={t("settings.history.maxVersionsPerNoteDesc")}
                  control={
                    <Slider
                      value={settings.history.maxVersionsPerNote}
                      min={5}
                      max={200}
                      step={5}
                      onChange={(maxVersionsPerNote) => setHistory({ maxVersionsPerNote })}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.history.maxAgeDays")}
                  description={t("settings.history.maxAgeDaysDesc")}
                  control={
                    <Slider
                      value={settings.history.maxAgeDays}
                      min={7}
                      max={365}
                      step={7}
                      onChange={(maxAgeDays) => setHistory({ maxAgeDays })}
                    />
                  }
                />
                <SettingRow
                  label={t("settings.history.maxTotalSizeMb")}
                  description={t("settings.history.maxTotalSizeMbDesc")}
                  control={
                    <Slider
                      value={settings.history.maxTotalSizeMb}
                      min={10}
                      max={1000}
                      step={10}
                      onChange={(maxTotalSizeMb) => setHistory({ maxTotalSizeMb })}
                    />
                  }
                />
              </div>
            </>
          )}

          {section === "attachments" && (
            <>
              <SectionTitle>{t("settings.attachments.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.attachments.mode")}
                  description={t("settings.attachments.modeDesc")}
                  control={
                    <div className="settings-segmented">
                      {(["vaultFolder", "nextToNote", "subfolder"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={settings.attachments.mode === mode ? "active" : ""}
                          onClick={() => setAttachments({ mode })}
                        >
                          {t(`settings.attachments.mode_${mode}`)}
                        </button>
                      ))}
                    </div>
                  }
                />
                {settings.attachments.mode === "vaultFolder" && (
                  <SettingRow
                    label={t("settings.attachments.vaultFolderName")}
                    description={t("settings.attachments.vaultFolderNameDesc")}
                    control={
                      <input
                        className="field"
                        style={{ width: 180 }}
                        value={settings.attachments.vaultFolderName}
                        onChange={(e) => setAttachments({ vaultFolderName: e.target.value })}
                      />
                    }
                  />
                )}
                {settings.attachments.mode === "subfolder" && (
                  <SettingRow
                    label={t("settings.attachments.subfolderName")}
                    description={t("settings.attachments.subfolderNameDesc")}
                    control={
                      <input
                        className="field"
                        style={{ width: 180 }}
                        value={settings.attachments.subfolderName}
                        onChange={(e) => setAttachments({ subfolderName: e.target.value })}
                      />
                    }
                  />
                )}
                <SettingRow
                  label={t("settings.attachments.loadExternalImages")}
                  description={t("settings.attachments.loadExternalImagesDesc")}
                  control={
                    <Toggle
                      checked={settings.attachments.loadExternalImages}
                      onChange={(loadExternalImages) => setAttachments({ loadExternalImages })}
                      ariaLabel={t("settings.attachments.loadExternalImages")}
                    />
                  }
                />
              </div>
            </>
          )}

          {section === "sync" && (
            <>
              <SectionTitle>{t("settings.sync.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.sync.mechanism")}
                  description={t("settings.sync.mechanismDesc")}
                  control={
                    <div className="settings-segmented">
                      {(["none", "git", "server", "cloud"] as const).map((mechanism) => (
                        <button
                          key={mechanism}
                          type="button"
                          disabled={mechanism === "cloud"}
                          className={settings.sync.mechanism === mechanism ? "active" : ""}
                          onClick={() => setSyncMechanism(mechanism)}
                          title={mechanism === "cloud" ? t(`settings.sync.mechanism_${mechanism}ComingSoon`) : undefined}
                        >
                          {t(`settings.sync.mechanism_${mechanism}`)}
                        </button>
                      ))}
                    </div>
                  }
                />
              </div>

              {settings.sync.mechanism === "git" && (
                <>
                  <p className="settings-warning">{t("settings.sync.gitEncryptionWarning")}</p>
                  <h3 className="settings-card-label">{t("settings.sync.git.title")}</h3>
                  <div className="settings-card">
                    <SettingRow
                      label={t("settings.sync.git.remoteName")}
                      description={t("settings.sync.git.remoteNameDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 160 }}
                          value={settings.sync.git.remoteName}
                          onChange={(e) => setSyncGit({ remoteName: e.target.value })}
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.git.remoteUrl")}
                      description={t("settings.sync.git.remoteUrlDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 260 }}
                          value={settings.sync.git.remoteUrl}
                          onChange={(e) => setSyncGit({ remoteUrl: e.target.value })}
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.git.branch")}
                      description={t("settings.sync.git.branchDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 160, fontFamily: "var(--font-mono)" }}
                          value={settings.sync.git.branch}
                          onChange={(e) => setSyncGit({ branch: e.target.value })}
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.git.authorName")}
                      description={t("settings.sync.git.authorDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 200 }}
                          value={settings.sync.git.authorName}
                          onChange={(e) => setSyncGit({ authorName: e.target.value })}
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.git.authorEmail")}
                      description={t("settings.sync.git.authorDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 200 }}
                          value={settings.sync.git.authorEmail}
                          onChange={(e) => setSyncGit({ authorEmail: e.target.value })}
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.git.autocommit")}
                      description={t("settings.sync.git.autocommitDesc")}
                      control={
                        <div className="settings-segmented">
                          {(["off", "manual", "scheduled"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              className={settings.sync.git.autocommit === mode ? "active" : ""}
                              onClick={() => setSyncGit({ autocommit: mode })}
                            >
                              {t(`settings.sync.git.autocommit_${mode}`)}
                            </button>
                          ))}
                        </div>
                      }
                    />
                    {settings.sync.git.autocommit === "scheduled" && (
                      <SettingRow
                        label={t("settings.sync.git.autocommitInterval")}
                        description={t("settings.sync.git.autocommitIntervalDesc")}
                        control={
                          <Slider
                            value={settings.sync.git.autocommitIntervalMinutes}
                            min={5}
                            max={180}
                            step={5}
                            onChange={(autocommitIntervalMinutes) => setSyncGit({ autocommitIntervalMinutes })}
                          />
                        }
                      />
                    )}
                    <SettingRow
                      label={t("settings.sync.git.autopullOnStartup")}
                      description={t("settings.sync.git.autopullOnStartupDesc")}
                      control={
                        <Toggle
                          checked={settings.sync.git.autopullOnStartup}
                          onChange={(autopullOnStartup) => setSyncGit({ autopullOnStartup })}
                          ariaLabel={t("settings.sync.git.autopullOnStartup")}
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.git.commitMessageTemplate")}
                      description={t("settings.sync.git.commitMessageTemplateDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 260, fontFamily: "var(--font-mono)" }}
                          value={settings.sync.git.commitMessageTemplate}
                          onChange={(e) => setSyncGit({ commitMessageTemplate: e.target.value })}
                        />
                      }
                    />
                  </div>
                </>
              )}

              {settings.sync.mechanism === "server" && (
                <>
                  <h3 className="settings-card-label">{t("settings.sync.server.title")}</h3>
                  <div className="settings-card">
                    <SettingRow
                      label={t("settings.sync.server.baseUrl")}
                      description={t("settings.sync.server.baseUrlDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 260 }}
                          value={settings.sync.server.baseUrl}
                          onChange={(e) => setSyncServer({ baseUrl: e.target.value })}
                          placeholder="https://sync.example.com"
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.server.deviceName")}
                      description={t("settings.sync.server.deviceNameDesc")}
                      control={
                        <input
                          className="field"
                          style={{ width: 200 }}
                          value={settings.sync.server.deviceName}
                          onChange={(e) => setSyncServer({ deviceName: e.target.value })}
                        />
                      }
                    />
                    <SettingRow
                      label={t("settings.sync.server.autoSync")}
                      description={t("settings.sync.server.autoSyncDesc")}
                      control={
                        <div className="settings-segmented">
                          {(["off", "manual", "scheduled"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              className={settings.sync.server.autoSync === mode ? "active" : ""}
                              onClick={() => setSyncServer({ autoSync: mode })}
                            >
                              {t(`settings.sync.git.autocommit_${mode}`)}
                            </button>
                          ))}
                        </div>
                      }
                    />
                    {settings.sync.server.autoSync === "scheduled" && (
                      <SettingRow
                        label={t("settings.sync.server.autoSyncInterval")}
                        description={t("settings.sync.server.autoSyncIntervalDesc")}
                        control={
                          <Slider
                            value={settings.sync.server.autoSyncIntervalMinutes}
                            min={5}
                            max={180}
                            step={5}
                            onChange={(autoSyncIntervalMinutes) => setSyncServer({ autoSyncIntervalMinutes })}
                          />
                        }
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {section === "telegram" && (
            <>
              <SectionTitle>{t("settings.sections.telegram")}</SectionTitle>
              <TelegramSettings />
            </>
          )}

          {section === "plugins" && <PluginsSection />}

          {section === "vault" && (
            <>
              <SectionTitle>{t("settings.vault.title")}</SectionTitle>
              <div className="settings-card">
                <SettingRow
                  label={t("settings.vault.path")}
                  description={t("settings.vault.pathDesc")}
                  control={<span className="settings-vault-path">{vaultPath ?? "—"}</span>}
                />
              </div>
              <button type="button" className="btn-accent settings-open-vault" onClick={() => void openFolder()}>
                {t("sidebar.openFolder")}
              </button>
            </>
          )}
        </div>
      </div>
      {obsidianImport && (
        <ObsidianImportDialog
          path={obsidianImport.path}
          inspection={obsidianImport.inspection}
          onOpen={(path) => void open(path)}
          onClose={closeObsidianImport}
        />
      )}
    </div>,
    document.body,
  );
}

const slidersIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M2 4.5h7M12.5 4.5H14M2 8h2M7.5 8H14M2 11.5h7M12.5 11.5H14" />
    <circle cx="10.5" cy="4.5" r="1.5" />
    <circle cx="5.5" cy="8" r="1.5" />
    <circle cx="10.5" cy="11.5" r="1.5" />
  </svg>
);

const penIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="m11 2.5 2.5 2.5L6 12.5 3 13l.5-3L11 2.5z" />
  </svg>
);

const graphIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <circle cx="4" cy="11.5" r="1.8" />
    <circle cx="12" cy="4.5" r="1.8" />
    <circle cx="8" cy="12.5" r="1.8" />
    <path d="M5.5 10.5 10.5 5.5M5.8 11.8l1.7-.6M10.3 5.3l-1.4 1.7" />
  </svg>
);

function HotkeysSection() {
  const { t } = useTranslation();
  const commands = useSyncExternalStore(subscribeCommands, getCommandsSnapshot);
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const visible = trimmed
    ? commands.filter((c) => c.title.toLowerCase().includes(trimmed))
    : commands;

  return (
    <>
      <SectionTitle>{t("settings.sections.hotkeys")}</SectionTitle>
      <input
        type="search"
        className="field settings-search"
        style={{ marginBottom: "12px" }}
        placeholder={t("settings.hotkeys.searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      <div className="settings-card">
        {visible.map((command) => (
          <HotkeyRow key={command.id} command={command} />
        ))}
      </div>
    </>
  );
}

function HotkeyRow({ command }: { command: Command }) {
  const { t } = useTranslation();
  const overrides = useSettingsStore((s) => s.settings.hotkeys ?? {});
  const setSettings = useSettingsStore((s) => s.setSettings);
  const [capturing, setCapturing] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

  const currentKeys = keysForCommand(command.id, overrides);

  function applyBinding(keys: string) {
    setSettings({ hotkeys: { ...overrides, [command.id]: keys } });
    setCapturing(false);
    setPendingKeys(null);
    setConflictId(null);
  }

  function onCaptureKeyDown(e: React.KeyboardEvent) {
    e.preventDefault();
    if (e.key === "Escape") {
      setCapturing(false);
      setPendingKeys(null);
      setConflictId(null);
      return;
    }
    const combo = normalizeKeyEvent(e.nativeEvent);
    if (!combo) return;
    const conflict = findConflict(combo, overrides, command.id);
    if (conflict) {
      setPendingKeys(combo);
      setConflictId(conflict);
    } else {
      applyBinding(combo);
    }
  }

  function reassign() {
    if (!pendingKeys || !conflictId) return;
    setSettings({
      hotkeys: { ...overrides, [conflictId]: "", [command.id]: pendingKeys },
    });
    setCapturing(false);
    setPendingKeys(null);
    setConflictId(null);
  }

  function resetToDefault() {
    const next = { ...overrides };
    delete next[command.id];
    setSettings({ hotkeys: next });
  }

  return (
    <div className="hotkey-row">
      <div className="settings-row" style={{ padding: 0 }}>
        <div className="settings-row-text">
          <div className="settings-row-label">{command.title}</div>
        </div>
        <div className="settings-row-control hotkey-row-control">
          {capturing ? (
            <input
              className="hotkey-capture-input"
              autoFocus
              readOnly
              value={pendingKeys ? labelForKeys(pendingKeys) : t("settings.hotkeys.pressKeys")}
              onKeyDown={onCaptureKeyDown}
              onBlur={() => {
                setCapturing(false);
                setPendingKeys(null);
                setConflictId(null);
              }}
            />
          ) : (
            <button type="button" className="hotkey-current-btn" onClick={() => setCapturing(true)}>
              {currentKeys ? labelForKeys(currentKeys) : t("settings.hotkeys.unbound")}
            </button>
          )}
          <button
            type="button"
            className="settings-reset-btn"
            onClick={resetToDefault}
            title={t("settings.hotkeys.reset")}
          >
            {t("settings.hotkeys.reset")}
          </button>
        </div>
      </div>
      {conflictId && pendingKeys && (
        <div className="hotkey-conflict">
          <span>
            {t("settings.hotkeys.conflict", {
              keys: labelForKeys(pendingKeys),
              command: getCommand(conflictId)?.title ?? conflictId,
            })}
          </span>
          <button type="button" onClick={reassign}>
            {t("settings.hotkeys.reassign")}
          </button>
        </div>
      )}
    </div>
  );
}

const keyIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <circle cx="5" cy="8" r="3" />
    <path d="M7.5 8H14M11 8v3M13 8v2" />
  </svg>
);

const folderIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h2.5l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v5.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7z" />
  </svg>
);

const calendarIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <rect x="2.5" y="3.5" width="11" height="10.5" rx="1.2" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);

const templateIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" />
    <path d="M2.5 6.5h11" />
  </svg>
);

const tasksIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M3 4h1l1 1 1.5-1.5M3 9h1l1 1 1.5-1.5M3 14h1l1 1 1.5-1.5M9 4h4M9 9h4M9 14h4" />
  </svg>
);

const historyIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </svg>
);

const attachmentIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M10.5 3.5 4.8 9.2a2.2 2.2 0 0 0 3.1 3.1l6-6a1.4 1.4 0 0 0-2-2l-5.6 5.6" />
  </svg>
);

const syncIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <circle cx="5" cy="5" r="1.8" />
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="8.5" r="1.8" />
    <path d="M5 6.8V10.2M6.5 5.2h5.5M6 12l4.5-2.6" />
  </svg>
);

const telegramIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="m2 8.5 11-5-2.5 11L7 12l-1.5 2.5v-4L14 4" />
  </svg>
);

const pluginsIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M5.5 2.5v2M10.5 2.5v2M2.5 6h11v4a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3V6z" />
  </svg>
);

function PluginsSection() {
  const { t } = useTranslation();
  const enabledOverrides = useSettingsStore((s) => s.settings.plugins.enabled);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const [externalPlugins, setExternalPlugins] = useState<NodusPlugin[]>(() => pluginHost.listExternal());
  const [loadError, setLoadError] = useState<string | null>(null);

  function setEnabled(id: string, enabled: boolean) {
    setSettings({ plugins: { enabled: { ...enabledOverrides, [id]: enabled } } });
  }

  async function loadExternalPlugin() {
    setLoadError(null);
    const selection = await openFileDialog({
      multiple: false,
      filters: [{ name: "Plugin bundle", extensions: ["cjs", "js"] }],
    });
    if (typeof selection !== "string") return;
    try {
      const plugin = await pluginHost.loadExternal(selection);
      setExternalPlugins(pluginHost.listExternal());
      setSettings({ plugins: { enabled: { ...enabledOverrides, [plugin.id]: true } } });
    } catch (error) {
      setLoadError(String(error));
    }
  }

  return (
    <>
      <SectionTitle>{t("settings.sections.plugins")}</SectionTitle>
      <div className="settings-card">
        {[...ALL_PLUGINS, ...externalPlugins].map((plugin) => {
          const enabled = enabledOverrides[plugin.id] ?? plugin.defaultEnabled;
          return (
            <SettingRow
              key={plugin.id}
              label={t(plugin.nameKey, plugin.nameKey)}
              description={t(plugin.descriptionKey, plugin.descriptionKey)}
              control={
                <Toggle
                  checked={enabled}
                  onChange={(next) => setEnabled(plugin.id, next)}
                  ariaLabel={t(plugin.nameKey, plugin.nameKey)}
                />
              }
            />
          );
        })}
      </div>
      <button type="button" className="btn-accent settings-open-vault" onClick={() => void loadExternalPlugin()}>
        {t("settings.plugins.loadExternal")}
      </button>
      {loadError && <p className="settings-warning">{loadError}</p>}
    </>
  );
}
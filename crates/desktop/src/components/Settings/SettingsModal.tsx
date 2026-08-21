import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { pickVaultFolder } from "../../api/vault";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../../i18n";
import {
  DEFAULT_SETTINGS,
  useSettingsStore,
  type GraphColors,
  type ThemePreference,
} from "../../store/settingsStore";
import { useVaultStore } from "../../store/vaultStore";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import "./SettingsModal.css";

type Section = "general" | "editor" | "graph" | "vault";

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
  const open = useVaultStore((s) => s.open);
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

  async function openOtherVault() {
    const path = await pickVaultFolder();
    if (path) await open(path);
  }

  const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: t("settings.sections.general"), icon: slidersIcon },
    { id: "editor", label: t("settings.sections.editor"), icon: penIcon },
    { id: "graph", label: t("settings.sections.graph"), icon: graphIcon },
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
              <button type="button" className="btn-accent settings-open-vault" onClick={() => void openOtherVault()}>
                {t("sidebar.openFolder")}
              </button>
            </>
          )}
        </div>
      </div>
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

const folderIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h2.5l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v5.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7z" />
  </svg>
);
import { Copy, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeProvider";
import {
  CUSTOM_THEME_COLOR_FIELDS,
  type CustomTheme,
  type CustomThemeBase,
  type CustomThemeColors,
} from "../../theme/customThemes";
import {
  useSettingsStore,
  type ThemePreference,
} from "../../store/settingsStore";

function currentColors(): CustomThemeColors {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    CUSTOM_THEME_COLOR_FIELDS.map(({ key, cssVariable }) => [
      key,
      styles.getPropertyValue(cssVariable).trim(),
    ]),
  ) as CustomThemeColors;
}

function newThemeId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `theme-${Date.now()}`;
}

export function AppearanceSettings() {
  const { t } = useTranslation();
  const { effectiveTheme, setPreference } = useTheme();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const appearance = settings.appearance;
  const activeTheme = appearance.customThemes.find(
    (theme) => theme.id === appearance.activeCustomThemeId,
  );

  function setAppearance(partial: Partial<typeof appearance>) {
    setSettings({ appearance: { ...appearance, ...partial } });
  }

  function updateTheme(id: string, update: Partial<CustomTheme>) {
    setAppearance({
      customThemes: appearance.customThemes.map((theme) =>
        theme.id === id ? { ...theme, ...update } : theme,
      ),
    });
  }

  function createTheme(source?: CustomTheme) {
    const nextNumber = appearance.customThemes.length + 1;
    const theme: CustomTheme = {
      id: newThemeId(),
      name: source?.name
        ? t("settings.appearance.copyName", { name: source.name })
        : t("settings.appearance.defaultCustomName", { number: nextNumber }),
      base: source?.base ?? effectiveTheme,
      colors: source ? { ...source.colors } : currentColors(),
    };
    setAppearance({
      customThemes: [...appearance.customThemes, theme],
      activeCustomThemeId: theme.id,
    });
  }

  function removeTheme(id: string) {
    setAppearance({
      customThemes: appearance.customThemes.filter((theme) => theme.id !== id),
      activeCustomThemeId:
        appearance.activeCustomThemeId === id
          ? null
          : appearance.activeCustomThemeId,
    });
  }

  return (
    <>
      <h2 className="settings-section-title">
        {t("settings.appearance.title")}
      </h2>

      <h3 className="settings-card-label">
        {t("settings.appearance.builtinTitle")}
      </h3>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">
              {t("settings.appearance.theme")}
            </div>
            <div className="settings-row-desc">
              {t("settings.appearance.themeDesc")}
            </div>
          </div>
          <div className="settings-row-control">
            <div className="settings-segmented">
              {(["light", "dark", "system"] as ThemePreference[]).map(
                (preference) => (
                  <button
                    key={preference}
                    type="button"
                    className={
                      !activeTheme && settings.theme === preference ? "active" : ""
                    }
                    onClick={() => setPreference(preference)}
                  >
                    {t(`settings.general.theme_${preference}`)}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="appearance-heading-row">
        <div>
          <h3 className="settings-card-label appearance-heading">
            {t("settings.appearance.customTitle")}
          </h3>
          <p className="appearance-section-desc">
            {t("settings.appearance.customDesc")}
          </p>
        </div>
        <button
          type="button"
          className="appearance-create-button"
          onClick={() => createTheme()}
        >
          <Plus size={15} />
          {t("settings.appearance.create")}
        </button>
      </div>

      {appearance.customThemes.length > 0 ? (
        <div className="appearance-theme-list">
          {appearance.customThemes.map((theme) => (
            <div
              key={theme.id}
              className={`appearance-theme-item${
                theme.id === appearance.activeCustomThemeId ? " active" : ""
              }`}
            >
              <button
                type="button"
                className="appearance-theme-select"
                onClick={() => setAppearance({ activeCustomThemeId: theme.id })}
              >
                <span
                  className="appearance-theme-swatch"
                  style={{
                    background: theme.colors.background,
                    borderColor: theme.colors.accent,
                  }}
                >
                  <span style={{ background: theme.colors.accent }} />
                  <span style={{ background: theme.colors.text }} />
                </span>
                <span className="appearance-theme-name">{theme.name}</span>
                <span className="appearance-theme-base">
                  {t(`settings.general.theme_${theme.base}`)}
                </span>
              </button>
              <button
                type="button"
                className="appearance-theme-action"
                title={t("settings.appearance.duplicate")}
                aria-label={t("settings.appearance.duplicate")}
                onClick={() => createTheme(theme)}
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                className="appearance-theme-action danger"
                title={t("settings.appearance.delete")}
                aria-label={t("settings.appearance.delete")}
                onClick={() => removeTheme(theme.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="appearance-empty">
          {t("settings.appearance.empty")}
        </div>
      )}

      {activeTheme && (
        <>
          <h3 className="settings-card-label">
            {t("settings.appearance.editorTitle")}
          </h3>
          <div className="settings-card appearance-editor-card">
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">
                  {t("settings.appearance.name")}
                </div>
              </div>
              <div className="settings-row-control">
                <input
                  className="field appearance-name-input"
                  value={activeTheme.name}
                  onChange={(event) =>
                    updateTheme(activeTheme.id, { name: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">
                  {t("settings.appearance.base")}
                </div>
                <div className="settings-row-desc">
                  {t("settings.appearance.baseDesc")}
                </div>
              </div>
              <div className="settings-row-control">
                <div className="settings-segmented">
                  {(["light", "dark"] as CustomThemeBase[]).map((base) => (
                    <button
                      key={base}
                      type="button"
                      className={activeTheme.base === base ? "active" : ""}
                      onClick={() => updateTheme(activeTheme.id, { base })}
                    >
                      {t(`settings.general.theme_${base}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="appearance-color-grid">
              {CUSTOM_THEME_COLOR_FIELDS.map((field) => (
                <label key={field.key} className="appearance-color-field">
                  <span>
                    {t(`settings.appearance.colors.${field.key}`)}
                  </span>
                  <span className="appearance-color-value">
                    <code>{activeTheme.colors[field.key]}</code>
                    <input
                      type="color"
                      value={activeTheme.colors[field.key]}
                      onChange={(event) =>
                        updateTheme(activeTheme.id, {
                          colors: {
                            ...activeTheme.colors,
                            [field.key]: event.target.value,
                          },
                        })
                      }
                    />
                  </span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      <h3 className="settings-card-label">
        {t("settings.appearance.fontsTitle")}
      </h3>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">
              {t("settings.appearance.interfaceFont")}
            </div>
            <div className="settings-row-desc">
              {t("settings.appearance.fontDesc")}
            </div>
          </div>
          <div className="settings-row-control">
            <input
              className="field appearance-font-input"
              value={appearance.interfaceFont}
              placeholder={t("settings.appearance.defaultFont")}
              onChange={(event) =>
                setAppearance({ interfaceFont: event.target.value })
              }
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">
              {t("settings.appearance.monospaceFont")}
            </div>
            <div className="settings-row-desc">
              {t("settings.appearance.monospaceFontDesc")}
            </div>
          </div>
          <div className="settings-row-control">
            <input
              className="field appearance-font-input"
              value={appearance.monospaceFont}
              placeholder={t("settings.appearance.defaultFont")}
              onChange={(event) =>
                setAppearance({ monospaceFont: event.target.value })
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}

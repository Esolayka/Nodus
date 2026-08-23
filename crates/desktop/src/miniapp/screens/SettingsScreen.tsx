import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, persistLanguage, type SupportedLanguage } from "../../i18n";
import { useMiniAppThemeStore, type MiniAppThemePreference } from "../store/themeStore";
import { haptic } from "../telegram";

const THEME_OPTIONS: MiniAppThemePreference[] = ["system", "light", "dark"];

function OptionRow({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="settings-option-row" onClick={() => (haptic(), onSelect())}>
      <span>{label}</span>
      {selected && <Check size={17} className="settings-option-check" />}
    </button>
  );
}

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const preference = useMiniAppThemeStore((s) => s.preference);
  const setPreference = useMiniAppThemeStore((s) => s.setPreference);

  function changeLanguage(lang: SupportedLanguage) {
    void i18n.changeLanguage(lang);
    persistLanguage(lang);
  }

  return (
    <div className="settings-screen">
      <p className="miniapp-section-label">{t("miniapp.settings.appearance.title")}</p>
      <div className="miniapp-card">
        {THEME_OPTIONS.map((option) => (
          <OptionRow
            key={option}
            label={t(`miniapp.settings.appearance.${option}`)}
            selected={preference === option}
            onSelect={() => setPreference(option)}
          />
        ))}
      </div>

      <p className="miniapp-section-label">{t("miniapp.settings.language.title")}</p>
      <div className="miniapp-card">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <OptionRow
            key={lang}
            label={t(`miniapp.settings.language.${lang}`)}
            selected={i18n.language === lang}
            onSelect={() => changeLanguage(lang)}
          />
        ))}
      </div>
    </div>
  );
}

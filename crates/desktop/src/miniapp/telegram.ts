import { useEffect } from "react";

// Minimal typing for the pieces of the Telegram Web App SDK this app
// actually uses. Loaded from https://telegram.org/js/telegram-web-app.js
// as a plain <script> tag in miniapp.html — `window.Telegram` simply won't
// exist outside a real Telegram client (e.g. testing in a plain browser),
// and every function here is written to degrade gracefully when that's
// the case rather than crash.

interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  destructive_text_color?: string;
}

interface TelegramMainButton {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isActive: boolean;
  setText(text: string): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
}

interface TelegramBackButton {
  isVisible: boolean;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  show(): void;
  hide(): void;
}

interface TelegramHapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    start_param?: string;
    user?: { id: number; first_name: string; username?: string };
  };
  themeParams: TelegramThemeParams;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  MainButton: TelegramMainButton;
  BackButton: TelegramBackButton;
  HapticFeedback: TelegramHapticFeedback;
  ready(): void;
  expand(): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  close(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function isInsideTelegram(): boolean {
  return getWebApp() !== null;
}

export function initTelegram(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
}

export function getStartParam(): string | null {
  return getWebApp()?.initDataUnsafe.start_param ?? null;
}

/** A light tap for ordinary taps (buttons, rows, tabs) — a no-op outside
 * Telegram, same as every other WebApp call here. */
export function haptic(): void {
  getWebApp()?.HapticFeedback.impactOccurred("light");
}

/** A slightly more distinct buzz for "this completed" moments (note
 * created, device linked, task checked off) — not just any tap. */
export function hapticSuccess(): void {
  getWebApp()?.HapticFeedback.notificationOccurred("success");
}

export function getInitData(): string | null {
  const webApp = getWebApp();
  if (!webApp || !webApp.initData) return null;
  return webApp.initData;
}

/** Maps Telegram's theme variables onto our own CSS custom properties, so
 * existing components that already read `var(--bg-primary)` etc. look
 * native inside Telegram without a parallel color system. Falls back to
 * the app's own dark palette outside Telegram. */
export function applyTelegramTheme(): void {
  const webApp = getWebApp();
  const root = document.documentElement;
  if (!webApp) {
    root.dataset.theme = "dark";
    return;
  }
  const t = webApp.themeParams;
  const set = (name: string, value: string | undefined, fallback: string) => {
    root.style.setProperty(name, value || fallback);
  };
  set("--bg-primary", t.bg_color, "#1e1e1e");
  set("--bg-secondary", t.secondary_bg_color, "#161616");
  set("--bg-tertiary", t.section_bg_color, "#242424");
  set("--text-normal", t.text_color, "#dadada");
  set("--text-muted", t.hint_color, "#a3a3a3");
  set("--accent", t.button_color || t.link_color, "#7f6df2");
  set("--accent-text", t.button_text_color, "#ffffff");
  set("--danger", t.destructive_text_color, "#e05252");
  root.dataset.theme = webApp.colorScheme;
}

export function useMainButton(options: { text: string; onClick: () => void; visible: boolean; enabled?: boolean }): void {
  const { text, onClick, visible, enabled } = options;
  useEffect(() => {
    const webApp = getWebApp();
    if (!webApp) return;
    const { MainButton } = webApp;
    MainButton.setText(text);
    if (visible) {
      MainButton.show();
      if (enabled === false) MainButton.disable();
      else MainButton.enable();
    } else {
      MainButton.hide();
    }
    MainButton.onClick(onClick);
    return () => {
      MainButton.offClick(onClick);
    };
  }, [text, onClick, visible, enabled]);
}

export function hideMainButton(): void {
  getWebApp()?.MainButton.hide();
}

/** Wires Telegram's own back button to `onBack` for as long as the calling
 * screen is mounted, instead of drawing a custom one — the spec's own
 * instruction to use Telegram's chrome for what it's for. A no-op outside
 * Telegram; screens fall back to their own in-page back button in that
 * case (see MiniApp.css), since there's no native chrome to lean on in a
 * plain browser tab. */
export function useBackButton(onBack: (() => void) | null): void {
  useEffect(() => {
    const webApp = getWebApp();
    if (!webApp || !onBack) return;
    webApp.BackButton.onClick(onBack);
    webApp.BackButton.show();
    return () => {
      webApp.BackButton.offClick(onBack);
      webApp.BackButton.hide();
    };
  }, [onBack]);
}

import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "./ui/Tooltip";
import "./TitleBar.css";

async function windowAction(action: "minimize" | "maximize" | "close") {
  let appWindow: ReturnType<typeof getCurrentWindow>;
  try {
    appWindow = getCurrentWindow();
  } catch {
    // getCurrentWindow() itself throws synchronously outside a Tauri window
    // (e.g. plain browser) — nothing to do in that environment.
    return;
  }
  try {
    if (action === "minimize") await appWindow.minimize();
    else if (action === "maximize") await appWindow.toggleMaximize();
    else await appWindow.close();
  } catch (error) {
    // A real failure here (permission denied, IPC error, ...) should be
    // visible, not silently swallowed — that's exactly what made this
    // class of bug invisible last time.
    console.error(`[titlebar] ${action} failed:`, error);
  }
}

export function TitleBar() {
  const { t } = useTranslation();

  return (
    <header className="titlebar">
      {/* The drag region is a separate element from the controls, not an
          ancestor of them — Tauri's drag-region mousedown handling can
          trigger on any element inside a `data-tauri-drag-region`
          container, including descendants like these buttons, which starts
          a window drag instead of registering the click (a well-known
          Tauri custom-titlebar gotcha). Keeping it a sibling instead
          guarantees the buttons never sit inside a draggable area. */}
      <div className="titlebar-drag-fill" data-tauri-drag-region />
      <div className="titlebar-controls">
        <Tooltip label={t("titleBar.minimize")} placement="bottom">
          <button type="button" onClick={() => void windowAction("minimize")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M3 8h10" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.maximize")} placement="bottom">
          <button type="button" onClick={() => void windowAction("maximize")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip label={t("titleBar.close")} placement="bottom">
          <button type="button" className="titlebar-close" onClick={() => void windowAction("close")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
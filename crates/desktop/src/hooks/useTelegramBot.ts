import { useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { useVaultStore } from "../store/vaultStore";
import { startTelegramBotPolling, stopTelegramBotPolling } from "../lib/telegramBot";

/** Runs the bot's long-poll loop for exactly as long as it makes sense to:
 * Telegram integration enabled, hosted locally (the "server" placement's
 * bot runs inside `nodus-sync-server` instead, not here), a bot token
 * configured, and a vault open (there'd be nowhere to append messages to
 * otherwise). Any of those becoming false stops it; the dependency array
 * covers every condition that should restart or stop the loop. */
export function useTelegramBot() {
  const enabled = useSettingsStore((s) => s.settings.telegram.enabled);
  const placement = useSettingsStore((s) => s.settings.telegram.placement);
  const botToken = useSettingsStore((s) => s.settings.telegram.botToken.trim());
  const vaultPath = useVaultStore((s) => s.vaultPath);

  useEffect(() => {
    const shouldPoll = enabled && placement === "local" && botToken !== "" && vaultPath !== null;
    if (!shouldPoll) {
      stopTelegramBotPolling();
      return;
    }
    startTelegramBotPolling(botToken);
    return () => stopTelegramBotPolling();
  }, [enabled, placement, botToken, vaultPath]);
}

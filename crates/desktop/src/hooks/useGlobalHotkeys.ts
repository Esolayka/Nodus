import { useEffect } from "react";
import { runCommand } from "../lib/commandRegistry";
import { effectiveBindings, normalizeKeyEvent } from "../lib/hotkeyRegistry";
import { useCommandUsageStore } from "../store/commandUsageStore";
import { useSettingsStore } from "../store/settingsStore";

/** The single global keydown listener for every app-level hotkey. Only
 * modifier'd combos are ever considered (plain typing never sets
 * ctrl/meta), and `event.defaultPrevented` is checked first so a key
 * CodeMirror (or anything else) already consumed — e.g. Ctrl+F opening the
 * in-editor search panel — doesn't also fire a conflicting global command. */
export function useGlobalHotkeys() {
  const overrides = useSettingsStore((s) => s.settings.hotkeys ?? {});

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (!e.ctrlKey && !e.metaKey) return;
      const combo = normalizeKeyEvent(e);
      if (!combo) return;
      const bindings = effectiveBindings(overrides);
      const commandId = Object.keys(bindings).find((id) => bindings[id] === combo);
      if (!commandId) return;
      e.preventDefault();
      useCommandUsageStore.getState().recordUse(commandId);
      runCommand(commandId);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overrides]);
}

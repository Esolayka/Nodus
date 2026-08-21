import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";

/** Ctrl+Tab / Ctrl+Shift+Tab: step through the active pane's
 * most-recently-used tab order (see `cycleMru`'s doc comment for why
 * repeated presses don't just toggle between two tabs). Releasing Ctrl
 * commits wherever the cycle landed to the front of that order. */
export function useMruTabCycling() {
  const cyclingPaneRef = useRef<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Tab") return;
      e.preventDefault();
      const paneId = useWorkspaceStore.getState().activePaneId;
      if (!paneId) return;
      cyclingPaneRef.current = paneId;
      useWorkspaceStore.getState().cycleMru(paneId, e.shiftKey ? -1 : 1);
    }
    function onKeyUp(e: KeyboardEvent) {
      if ((e.key === "Control" || e.key === "Meta") && cyclingPaneRef.current) {
        useWorkspaceStore.getState().commitMruCycle(cyclingPaneRef.current);
        cyclingPaneRef.current = null;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}

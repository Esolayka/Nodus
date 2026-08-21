import { useEffect } from "react";
import { onVaultChanged } from "../api/vault";
import { useVaultStore } from "../store/vaultStore";
import { useWorkspaceStore } from "../store/workspaceStore";

/** Subscribes once to disk-change events pushed from the Rust watcher and
 * fans them out to the tree (structural changes) and open buffers (content). */
export function useVaultEvents() {
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const bumpChangeVersion = useVaultStore((s) => s.bumpChangeVersion);
  const handleExternalChange = useWorkspaceStore((s) => s.handleExternalChange);

  useEffect(() => {
    const unlistenPromise = onVaultChanged((change) => {
      if (change.kind === "created" || change.kind === "removed") {
        void refreshTree();
      }
      bumpChangeVersion();
      void handleExternalChange(change);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshTree, bumpChangeVersion, handleExternalChange]);
}

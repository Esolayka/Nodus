import { useState } from "react";
import { inspectObsidianVault, pickVaultFolder } from "../api/vault";
import { useVaultStore } from "../store/vaultStore";
import type { ObsidianInspection } from "../types/vault";

/** Picking a folder to open as a vault always goes through this: if the
 * folder turns out to already be an Obsidian vault, opening is deferred
 * until the user has seen (and confirmed or dismissed) the settings and
 * compatibility report in `ObsidianImportDialog` — the folder itself is
 * never touched either way, since Nodus reads the same Markdown files
 * natively. Shared by every "open folder" entry point so none of them
 * can accidentally skip the detection step. */
export function useOpenVaultFolder() {
  const open = useVaultStore((s) => s.open);
  const [obsidianImport, setObsidianImport] = useState<{ path: string; inspection: ObsidianInspection } | null>(null);

  async function openFolder() {
    const path = await pickVaultFolder();
    if (!path) return;
    const inspection = await inspectObsidianVault(path);
    if (inspection.isObsidianVault) {
      setObsidianImport({ path, inspection });
    } else {
      await open(path);
    }
  }

  return { openFolder, obsidianImport, closeObsidianImport: () => setObsidianImport(null), open };
}

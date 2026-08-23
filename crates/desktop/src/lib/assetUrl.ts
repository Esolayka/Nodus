import { convertFileSrc } from "@tauri-apps/api/core";
import { useVaultStore } from "../store/vaultStore";

/** A loadable URL for a vault-relative path, via Tauri's asset protocol —
 * lets `<img>`/`<audio>`/`<video>` and pdf.js stream bytes straight from
 * disk instead of round-tripping the whole file through IPC as JSON, which
 * matters once files get into the tens or hundreds of megabytes.
 *
 * Never throws: this runs inside CodeMirror widgets' `toDOM()`, where an
 * exception would abort that whole render pass and blank the note, not just
 * fail one embed — so a missing/broken asset protocol degrades to an empty
 * src (a broken-image icon) instead. */
export function assetUrlFor(relativePath: string): string {
  try {
    const vaultPath = useVaultStore.getState().vaultPath ?? "";
    const separator = vaultPath.includes("\\") && !vaultPath.includes("/") ? "\\" : "/";
    const nativeRelative = separator === "\\" ? relativePath.split("/").join("\\") : relativePath;
    const absolute = vaultPath ? `${vaultPath}${separator}${nativeRelative}` : relativePath;
    return convertFileSrc(absolute);
  } catch {
    return "";
  }
}

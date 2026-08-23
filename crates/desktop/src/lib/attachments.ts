import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { EditorView } from "@codemirror/view";
import * as api from "../api/vault";
import { useSettingsStore } from "../store/settingsStore";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogv"]);

export type MediaKind = "image" | "pdf" | "audio" | "video";

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

export function mediaKindOf(path: string): MediaKind | null {
  const ext = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

export function isPdfPath(path: string): boolean {
  return PDF_EXTENSIONS.has(extensionOf(path));
}

/** Where a new attachment dropped/pasted/attached from `notePath` should
 * land, per the configured mode. */
export function resolveAttachmentFolder(notePath: string): string {
  const settings = useSettingsStore.getState().settings.attachments;
  const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  switch (settings.mode) {
    case "nextToNote":
      return noteDir;
    case "subfolder":
      return noteDir ? `${noteDir}/${settings.subfolderName}` : settings.subfolderName;
    case "vaultFolder":
    default:
      return settings.vaultFolderName;
  }
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Copies an external file (drag-and-drop source, or an "attach file"
 * dialog pick) into the vault and returns the `![[...]]` markdown to
 * insert. */
export async function attachFileFromPath(notePath: string, sourceAbsolute: string, desiredName: string): Promise<string> {
  const folder = resolveAttachmentFolder(notePath);
  const path = await api.importAttachmentFromPath(folder, desiredName, sourceAbsolute);
  return `![[${basename(path)}]]`;
}

/** Same as `attachFileFromPath` but for raw bytes already in memory (a
 * clipboard-pasted image). */
export async function attachBytes(notePath: string, desiredName: string, bytes: Uint8Array): Promise<string> {
  const folder = resolveAttachmentFolder(notePath);
  const path = await api.importAttachmentBytes(folder, desiredName, bytes);
  return `![[${basename(path)}]]`;
}

/** The "attach file" command: native file picker, then copied in the same
 * way a drag-and-drop would be. Returns the `![[...]]` markdown for each
 * file picked, or null if the user cancelled. */
export async function pickAndAttachFiles(notePath: string): Promise<string[] | null> {
  const selection = await openDialog({ multiple: true });
  if (!selection) return null;
  const paths = Array.isArray(selection) ? selection : [selection];
  if (paths.length === 0) return null;
  const results: string[] = [];
  for (const sourceAbsolute of paths) {
    results.push(await attachFileFromPath(notePath, sourceAbsolute, basename(sourceAbsolute.replace(/\\/g, "/"))));
  }
  return results;
}

/** Downloads an external image and replaces its `![alt](url)` markdown
 * with a local `![[...]]` embed — the "save locally" context-menu action.
 * Best-effort: relies on the exact markdown substring still being present
 * in the document (it's a quick fetch-then-replace, not expected to race
 * with anything). */
export async function saveExternalImageLocally(
  view: EditorView,
  notePath: string,
  url: string,
  alt: string,
): Promise<void> {
  const response = await fetch(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const ext = contentType.split("/")[1]?.split(";")[0] || url.split(".").pop()?.split(/[?#]/)[0] || "png";
  const safeName = (alt || "image").replace(/[\\/:*?"<>|]/g, "_");
  const markdown = await attachBytes(notePath, `${safeName}.${ext}`, bytes);

  const original = `![${alt}](${url})`;
  const doc = view.state.doc.toString();
  const idx = doc.indexOf(original);
  if (idx !== -1) {
    view.dispatch({ changes: { from: idx, to: idx + original.length, insert: markdown } });
  }
}

/** A collision-safe timestamped name for a clipboard paste, which has no
 * original filename to reuse. */
export function pastedImageName(mimeType: string): string {
  const ext = mimeType.split("/")[1]?.split("+")[0] || "png";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

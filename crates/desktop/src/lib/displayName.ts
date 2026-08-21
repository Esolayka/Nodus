const MARKDOWN_EXTENSIONS = ["md", "markdown", "txt"];

/** Display name for a note path: basename without the extension. */
export function displayName(path: string): string {
  const idx = path.lastIndexOf("/");
  const name = idx === -1 ? path : path.slice(idx + 1);
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (MARKDOWN_EXTENSIONS.includes(ext)) return name.slice(0, dot);
  }
  return name;
}
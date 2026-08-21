/** Strips the most common Markdown syntax so word/char counts reflect what
 * the live-preview actually shows, not the raw source. Not a full parser —
 * just enough to keep counts honest for everyday notes. */
export function stripMarkdown(content: string): string {
  let text = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  text = text.replace(/```[\s\S]*?```/g, (block) =>
    block
      .split("\n")
      .slice(1, -1)
      .join("\n"),
  );
  text = text.replace(/!\[\[([^\]]+)\]\]/g, "$1");
  text = text.replace(/\[\[([^\]|#]+)(#[^\]|]+)?(\|([^\]]+))?\]\]/g, (_m, target, _h, _p, alias) => alias ?? target);
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s*)?/gm, "");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  text = text.replace(/==(.*?)==/g, "$1");
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, "");
  return text;
}

export function wordCount(content: string): number {
  const text = stripMarkdown(content).trim();
  return text ? text.split(/\s+/).length : 0;
}

export function charCount(content: string): number {
  return stripMarkdown(content).trim().length;
}

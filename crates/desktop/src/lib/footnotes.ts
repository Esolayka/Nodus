export interface FootnoteDef {
  id: string;
  text: string;
  /** Character offset of the definition line's start, for scroll/jump. */
  position: number;
}

const DEF_RE = /^\[\^([^\]\s]+)\]:\s?(.*)$/;

/** Line-based scan for `[^id]: definition text` lines — same "good enough,
 * not a full CommonMark footnote parser" bar the rest of this app's
 * lightweight text scanners (outline, frontmatter display) already hold
 * themselves to. */
export function parseFootnoteDefs(text: string): FootnoteDef[] {
  const defs: FootnoteDef[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const match = DEF_RE.exec(line);
    if (match) defs.push({ id: match[1], text: match[2], position: offset });
    offset += line.length + 1;
  }
  return defs;
}

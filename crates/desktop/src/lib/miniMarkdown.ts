/** A small, self-contained Markdown -> DOM renderer for embed content
 * (`![[Note]]` transclusion). This is deliberately not the full live-preview
 * renderer — embeds show a read-only preview of another note's content, not
 * a second editable surface, so headings/paragraphs/lists/quotes/code plus
 * inline emphasis and links cover what people actually put in a note they'd
 * transclude. Tables/math/mermaid inside an embedded note render as plain
 * text here rather than not at all. */

export interface MiniRenderOptions {
  /** Resolves a wikilink target to a vault-relative path, or null if unresolved. */
  resolve: (target: string) => string | null;
  onFollowLink: (target: string, resolvedPath: string | null, newTab: boolean) => void;
  /** Renders a nested `![[Target]]`/`![[Target#Heading]]` embed, or returns
   * null to fall back to a plain link (used once depth/cycle limits hit). */
  renderEmbed: (target: string, heading: string | null) => Node | null;
}

const INLINE_RE =
  /(\!\[\[([^\]]+)\]\])|(\[\[([^\]]+)\]\])|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(\*([^*]+)\*)|(`([^`]+)`)/g;

function renderInline(text: string, opts: MiniRenderOptions): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
    if (m[1]) {
      const inner = m[2];
      const hashIdx = inner.indexOf("#");
      const target = hashIdx === -1 ? inner : inner.slice(0, hashIdx);
      const heading = hashIdx === -1 ? null : inner.slice(hashIdx + 1).trim();
      const nested = opts.renderEmbed(target.trim(), heading);
      frag.appendChild(nested ?? renderWikilink(target.trim(), null, opts));
    } else if (m[3]) {
      const { target, alias } = splitWikilinkInner(m[4]);
      frag.appendChild(renderWikilink(target, alias, opts));
    } else if (m[5]) {
      const strong = document.createElement("strong");
      strong.textContent = m[6];
      frag.appendChild(strong);
    } else if (m[7]) {
      const del = document.createElement("del");
      del.textContent = m[8];
      frag.appendChild(del);
    } else if (m[9]) {
      const em = document.createElement("em");
      em.textContent = m[10];
      frag.appendChild(em);
    } else if (m[11]) {
      const code = document.createElement("code");
      code.textContent = m[12];
      frag.appendChild(code);
    }
    last = start + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function splitWikilinkInner(inner: string): { target: string; alias: string | null } {
  const pipeIdx = inner.indexOf("|");
  if (pipeIdx === -1) {
    const hashIdx = inner.indexOf("#");
    return { target: (hashIdx === -1 ? inner : inner.slice(0, hashIdx)).trim(), alias: null };
  }
  const before = inner.slice(0, pipeIdx);
  const hashIdx = before.indexOf("#");
  const target = (hashIdx === -1 ? before : before.slice(0, hashIdx)).trim();
  return { target, alias: inner.slice(pipeIdx + 1).trim() };
}

function renderWikilink(target: string, alias: string | null, opts: MiniRenderOptions): HTMLElement {
  const resolvedPath = opts.resolve(target);
  const span = document.createElement("a");
  span.className = `cm-wikilink${resolvedPath ? "" : " cm-wikilink-unresolved"}`;
  span.textContent = alias ?? target;
  span.href = "#";
  span.addEventListener("click", (e) => {
    e.preventDefault();
    opts.onFollowLink(target, resolvedPath, e.ctrlKey || e.metaKey);
  });
  return span;
}

function renderParagraphLike(tag: string, text: string, opts: MiniRenderOptions): HTMLElement {
  const el = document.createElement(tag);
  el.appendChild(renderInline(text, opts));
  return el;
}

export function renderMiniMarkdown(content: string, opts: MiniRenderOptions): DocumentFragment {
  const root = document.createDocumentFragment();
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      root.appendChild(
        renderParagraphLike(`h${Math.min(heading[1].length + 2, 6)}`, heading[2], opts),
      );
      i++;
      continue;
    }

    const fence = /^(`{3,}|~{3,})/.exec(line.trim());
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker[0].repeat(3))) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = body.join("\n");
      pre.appendChild(code);
      root.appendChild(pre);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const bq = document.createElement("blockquote");
      bq.appendChild(renderInline(quoteLines.join(" "), opts));
      root.appendChild(bq);
      continue;
    }

    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      const ordered = /\d/.test(listItem[1]);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        const li = document.createElement("li");
        li.appendChild(renderInline(m[2], opts));
        list.appendChild(li);
        i++;
      }
      root.appendChild(list);
      continue;
    }

    // Paragraph: consecutive non-blank, non-special lines joined by a space.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^(`{3,}|~{3,})/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    root.appendChild(renderParagraphLike("p", paraLines.join(" "), opts));
  }

  return root;
}

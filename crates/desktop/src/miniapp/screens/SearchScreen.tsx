import { useEffect, useState } from "react";
import type { SearchFileResult } from "../../types/vault";
import { displayName } from "../../lib/displayName";
import { readSearch } from "../sync";

export function SearchScreen({
  onOpen,
  initialQuery,
}: {
  onOpen: (path: string) => void;
  /** Set when arriving here from a tag tap — runs immediately, and again
   * whenever a new one comes in (tapping a different tag while already on
   * this screen shouldn't require clearing the field by hand first). */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<SearchFileResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function runSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await readSearch(q.trim()));
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (initialQuery) void runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  return (
    <div className="search-screen">
      <input
        className="field search-input"
        value={query}
        onChange={(e) => void runSearch(e.target.value)}
        placeholder="Search the vault…"
        autoCapitalize="off"
        autoCorrect="off"
      />
      {searching && <p className="miniapp-empty">Searching…</p>}
      {!searching && results && results.length === 0 && <p className="miniapp-empty">No matches.</p>}
      {!searching &&
        results?.map((file) => (
          <button key={file.path} type="button" className="search-result" onClick={() => onOpen(file.path)}>
            <div className="search-result-path">{displayName(file.path)}</div>
            {file.matches.slice(0, 2).map((m) => (
              <div key={m.line} className="search-result-line">
                {m.text.trim()}
              </div>
            ))}
          </button>
        ))}
    </div>
  );
}

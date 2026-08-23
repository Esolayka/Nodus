import { useEffect, useState } from "react";
import { Hash } from "lucide-react";
import type { TagCount } from "../../types/vault";
import { readTags } from "../sync";

export function TagsScreen({ onOpenTag }: { onOpenTag: (tag: string) => void }) {
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readTags()
      .then((t) => {
        if (!cancelled) setTags(t);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="miniapp-empty">{error}</p>;
  if (!tags) return <p className="miniapp-empty">Loading…</p>;
  if (tags.length === 0) return <p className="miniapp-empty">No tags yet.</p>;

  return (
    <div className="tags-screen miniapp-card">
      {tags.map((t) => (
        <button key={t.tag} type="button" className="tag-row" onClick={() => onOpenTag(t.tag)}>
          <span className="tag-row-icon">
            <Hash size={14} />
          </span>
          <span className="tag-row-name">{t.tag}</span>
          <span className="tag-row-count">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

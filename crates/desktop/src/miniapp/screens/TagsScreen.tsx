import { useEffect, useState } from "react";
import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TagCount } from "../../types/vault";
import { readTags } from "../sync";
import { haptic } from "../telegram";

export function TagsScreen({ onOpenTag }: { onOpenTag: (tag: string) => void }) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readTags()
      .then((result) => {
        if (!cancelled) setTags(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="miniapp-empty">{error}</p>;
  if (!tags) return <p className="miniapp-empty">{t("miniapp.common.loading")}</p>;
  if (tags.length === 0) return <p className="miniapp-empty">{t("miniapp.tags.empty")}</p>;

  return (
    <div className="tags-screen miniapp-card">
      {tags.map((tagCount) => (
        <button key={tagCount.tag} type="button" className="tag-row" onClick={() => (haptic(), onOpenTag(tagCount.tag))}>
          <span className="tag-row-icon">
            <Hash size={14} />
          </span>
          <span className="tag-row-name">{tagCount.tag}</span>
          <span className="tag-row-count">{tagCount.count}</span>
        </button>
      ))}
    </div>
  );
}

import { useEffect } from "react";
import { useGraphStore } from "../store/graphStore";
import { useVaultStore } from "../store/vaultStore";

/** Loads vault graph data and refreshes it whenever the vault changes. */
export function useGraphData() {
  const data = useGraphStore((s) => s.data);
  const error = useGraphStore((s) => s.error);
  const load = useGraphStore((s) => s.load);
  const changeVersion = useVaultStore((s) => s.changeVersion);

  useEffect(() => {
    void load();
  }, [changeVersion, load]);

  return { data, error };
}
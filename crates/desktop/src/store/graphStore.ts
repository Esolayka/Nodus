import { create } from "zustand";
import * as api from "../api/vault";
import type { GraphData } from "../types/vault";

interface GraphState {
  data: GraphData | null;
  error: string | null;
  loading: boolean;
  load: () => Promise<void>;
}

/** Vault-wide graph data, fetched on demand (graph views subscribe to
 * `changeVersion` and reload when the vault changes). */
export const useGraphStore = create<GraphState>((set) => ({
  data: null,
  error: null,
  loading: false,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.getGraphData();
      set({ data, error: null, loading: false });
    } catch (error) {
      console.error("[graph] failed to load graph data:", error);
      set({ data: null, error: String(error), loading: false });
    }
  },
}));

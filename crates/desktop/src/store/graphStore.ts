import { create } from "zustand";
import * as api from "../api/vault";
import type { GraphData } from "../types/vault";

interface GraphState {
  data: GraphData | null;
  error: string | null;
  load: () => Promise<void>;
}

/** Vault-wide graph data, fetched on demand (graph views subscribe to
 * `changeVersion` and reload when the vault changes). */
export const useGraphStore = create<GraphState>((set) => ({
  data: null,
  error: null,
  load: async () => {
    try {
      const data = await api.getGraphData();
      set({ data, error: null });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));
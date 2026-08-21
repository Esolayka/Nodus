import { getTagCounts } from "../api/vault";
import { useVaultStore } from "../store/vaultStore";
import type { TagCount } from "../types/vault";

/** A synchronously-readable cache of tag counts for the `#` autocomplete
 * extension — CodeMirror completion sources aren't React components, so
 * they can't `useEffect`/`useQuery` their way to fresh data; this mirrors
 * how `noteIndex` already keeps a plain synchronous snapshot in
 * `vaultStore` for the same reason. */
let cache: TagCount[] = [];
let subscribed = false;

function refresh() {
  void getTagCounts()
    .then((counts) => {
      cache = counts;
    })
    .catch(() => {
      // No vault open yet, or the call raced a vault switch — keep the
      // last-known cache rather than surfacing an error for this.
    });
}

export function getCachedTagCounts(): TagCount[] {
  return cache;
}

/** Call once at startup. Refreshes immediately and on every vault change. */
export function ensureTagIndexSubscribed() {
  if (subscribed) return;
  subscribed = true;
  refresh();
  useVaultStore.subscribe((state, prev) => {
    if (state.vaultPath !== prev.vaultPath || state.changeVersion !== prev.changeVersion) {
      refresh();
    }
  });
}

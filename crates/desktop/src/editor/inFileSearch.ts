import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import i18next from "../i18n";

/** Match count + which one is "current" relative to the main selection —
 * the "3 of 17" the spec asks for. `@codemirror/search` doesn't track this
 * itself, so it's recomputed from a fresh cursor scan on every relevant
 * update; fine at note-sized documents. */
function computeCount(view: EditorView): { current: number; total: number } {
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return { current: 0, total: 0 };
  const cursor = query.getCursor(view.state);
  const main = view.state.selection.main;
  let total = 0;
  let current = 0;
  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    total++;
    if (result.value.from === main.from && result.value.to === main.to) current = total;
  }
  return { current, total };
}

/** Our own panel DOM in place of `@codemirror/search`'s stock one — same
 * underlying search/replace primitives, styled to match the app instead of
 * CodeMirror's default look. */
function buildPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-nodus-search-panel";

  const findInput = document.createElement("input");
  findInput.className = "cm-nodus-search-input";
  findInput.placeholder = i18next.t("search.findPlaceholder");

  const countEl = document.createElement("span");
  countEl.className = "cm-nodus-search-count";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "cm-nodus-search-btn";
  prevBtn.textContent = "↑";
  prevBtn.title = "Shift+Enter";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "cm-nodus-search-btn";
  nextBtn.textContent = "↓";
  nextBtn.title = "Enter";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "cm-nodus-search-btn cm-nodus-search-close";
  closeBtn.textContent = "×";

  const findRow = document.createElement("div");
  findRow.className = "cm-nodus-search-row";
  findRow.append(findInput, countEl, prevBtn, nextBtn, closeBtn);

  const replaceInput = document.createElement("input");
  replaceInput.className = "cm-nodus-search-input";
  replaceInput.placeholder = i18next.t("search.replacePlaceholder");

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "cm-nodus-search-btn";
  replaceBtn.textContent = i18next.t("search.replaceMode");

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.type = "button";
  replaceAllBtn.className = "cm-nodus-search-btn";
  replaceAllBtn.textContent = i18next.t("search.applyReplaceConfirm");

  const replaceRow = document.createElement("div");
  replaceRow.className = "cm-nodus-search-row";
  replaceRow.append(replaceInput, replaceBtn, replaceAllBtn);

  dom.append(findRow, replaceRow);

  function refreshCount() {
    const { current, total } = computeCount(view);
    countEl.textContent = total > 0 ? `${current || "?"} / ${total}` : "0 / 0";
  }

  function dispatchQuery() {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: findInput.value, replace: replaceInput.value }),
      ),
    });
    refreshCount();
  }

  findInput.oninput = dispatchQuery;
  replaceInput.oninput = dispatchQuery;

  findInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
      refreshCount();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  };
  replaceInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceNext(view);
      refreshCount();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  };

  prevBtn.onclick = () => {
    findPrevious(view);
    refreshCount();
  };
  nextBtn.onclick = () => {
    findNext(view);
    refreshCount();
  };
  replaceBtn.onclick = () => {
    replaceNext(view);
    refreshCount();
  };
  replaceAllBtn.onclick = () => {
    replaceAll(view);
    refreshCount();
  };
  closeBtn.onclick = () => closeSearchPanel(view);

  return {
    dom,
    top: true,
    mount() {
      const existing = getSearchQuery(view.state);
      if (existing.search) findInput.value = existing.search;
      if (existing.replace) replaceInput.value = existing.replace;
      findInput.focus();
      findInput.select();
      refreshCount();
    },
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) refreshCount();
    },
  };
}

/** Opens the panel and focuses it — safe to call whether or not it's
 * already open (matches `openSearchPanel`'s own contract). */
export function openInFileSearch(view: EditorView) {
  openSearchPanel(view);
}

export function isInFileSearchOpen(view: EditorView): boolean {
  return searchPanelOpen(view.state);
}

/** The whole in-editor find/replace extension — `search()` with our panel
 * plugged in via `createPanel`, plus our own Ctrl+F binding (stock
 * `searchKeymap` is deliberately not included: its default panel is gone,
 * and Mod-f needs to route through the same `openInFileSearch` the command
 * registry's "app.findInNote" command uses). */
export function inFileSearch() {
  return search({ top: true, createPanel: buildPanel });
}

import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { assetUrlFor } from "../../lib/assetUrl";
import { loadPdfDocument, type PDFDocumentProxy } from "../../lib/pdfjs";
import { consumePendingPdfPage, useWorkspaceStore } from "../../store/workspaceStore";
import { PdfPageCanvas } from "./PdfPageCanvas";
import { PdfThumbnailSidebar } from "./PdfThumbnailSidebar";
import "./PdfViewerTab.css";

const PAGE_GAP = 12;
const RENDER_BUFFER = 1;

interface SearchMatch {
  page: number;
  snippet: string;
}

export function PdfViewerTab({ path }: { path: string }) {
  const { t } = useTranslation();
  const pdfJumpVersion = useWorkspaceStore((s) => s.pdfJumpVersion);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [visibleRange, setVisibleRange] = useState({ from: 1, to: 1 });
  const [thumbnailsOpen, setThumbnailsOpen] = useState(true);
  const [pageInput, setPageInput] = useState("1");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fittedRef = useRef(false);
  const url = useMemo(() => assetUrlFor(path), [path]);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setPageSize(null);
    fittedRef.current = false;
    loadPdfDocument(url).then(async (loaded) => {
      if (cancelled) return;
      setDoc(loaded);
      const firstPage = await loaded.getPage(1);
      if (cancelled) return;
      const viewport = firstPage.getViewport({ scale: 1 });
      setPageSize({ width: viewport.width, height: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Fit the first page to the column's width once, when the document loads.
  useEffect(() => {
    if (!pageSize || fittedRef.current || !scrollRef.current) return;
    fittedRef.current = true;
    const containerWidth = scrollRef.current.clientWidth - 32;
    if (containerWidth > 0) setScale(Math.min(1.5, containerWidth / pageSize.width));
  }, [pageSize]);

  const rowHeight = pageSize ? pageSize.height * scale + PAGE_GAP : 0;

  function updateVisibleRange() {
    const el = scrollRef.current;
    if (!el || !doc || !rowHeight) return;
    const first = Math.max(1, Math.floor(el.scrollTop / rowHeight) + 1 - RENDER_BUFFER);
    const last = Math.min(doc.numPages, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + RENDER_BUFFER);
    setVisibleRange({ from: first, to: last });
    const centerPage = Math.round(el.scrollTop / rowHeight) + 1;
    setCurrentPage(Math.min(Math.max(centerPage, 1), doc.numPages));
  }

  useEffect(() => {
    updateVisibleRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight, doc]);

  function scrollToPage(page: number) {
    const el = scrollRef.current;
    if (!el || !rowHeight) return;
    el.scrollTop = (page - 1) * rowHeight;
    setPageInput(String(page));
  }

  useEffect(() => {
    if (!rowHeight) return;
    const page = consumePendingPdfPage(path);
    if (page != null) scrollToPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight, pdfJumpVersion, path]);

  function goToPage() {
    const n = Number(pageInput);
    if (doc && Number.isFinite(n) && n >= 1 && n <= doc.numPages) scrollToPage(n);
  }

  function zoom(delta: number) {
    setScale((s) => Math.min(3, Math.max(0.25, Math.round((s + delta) * 100) / 100)));
  }

  async function runSearch() {
    if (!doc || !searchQuery.trim()) {
      setSearchMatches([]);
      return;
    }
    setSearching(true);
    const query = searchQuery.trim().toLowerCase();
    const matches: SearchMatch[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      const idx = text.toLowerCase().indexOf(query);
      if (idx !== -1) {
        matches.push({ page: i, snippet: text.slice(Math.max(0, idx - 30), idx + query.length + 30) });
      }
    }
    setSearchMatches(matches);
    setSearching(false);
  }

  if (!doc || !pageSize) {
    return <div className="pdf-viewer pdf-viewer-loading">{t("pdf.loading")}</div>;
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button
          type="button"
          className={`pdf-toolbar-btn${thumbnailsOpen ? " active" : ""}`}
          onClick={() => setThumbnailsOpen((v) => !v)}
          title={t("pdf.thumbnails")}
        >
          <LayoutGrid size={14} />
        </button>
        <div className="pdf-page-jump">
          <input
            type="text"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToPage();
            }}
            onBlur={goToPage}
          />
          <span>/ {doc.numPages}</span>
        </div>
        <div className="pdf-zoom">
          <button type="button" onClick={() => zoom(-0.1)} aria-label="Zoom out">
            <Minus size={14} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoom(0.1)} aria-label="Zoom in">
            <Plus size={14} />
          </button>
        </div>
        <input
          type="search"
          className="field pdf-search-input"
          placeholder={t("pdf.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
        />
      </div>
      <div className="pdf-body">
        {thumbnailsOpen && (
          <PdfThumbnailSidebar doc={doc} pageSize={pageSize} currentPage={currentPage} onSelect={scrollToPage} />
        )}
        <div className="pdf-main">
          <div ref={scrollRef} className="pdf-scroll" onScroll={updateVisibleRange}>
            <div className="pdf-page-list" style={{ height: doc.numPages * rowHeight, position: "relative" }}>
              {Array.from({ length: visibleRange.to - visibleRange.from + 1 }, (_, i) => visibleRange.from + i).map(
                (n) => (
                  <div
                    key={n}
                    className="pdf-page-row"
                    style={{ position: "absolute", top: (n - 1) * rowHeight, left: 0, right: 0 }}
                  >
                    <PdfPageCanvas
                      doc={doc}
                      pageNumber={n}
                      width={pageSize.width * scale}
                      height={pageSize.height * scale}
                      scale={scale}
                      shouldRender
                    />
                  </div>
                ),
              )}
            </div>
          </div>
          {searching && <p className="pdf-search-status">{t("pdf.searching")}</p>}
          {searchMatches.length > 0 && (
            <div className="pdf-search-results">
              {searchMatches.map((m) => (
                <button key={m.page} type="button" onClick={() => scrollToPage(m.page)}>
                  <span className="pdf-search-result-page">{t("pdf.page", { page: m.page })}</span>
                  <span className="pdf-search-result-snippet">…{m.snippet}…</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

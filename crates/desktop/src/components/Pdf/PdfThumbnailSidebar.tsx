import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../../lib/pdfjs";
import { PdfPageCanvas } from "./PdfPageCanvas";

const THUMB_SCALE = 0.15;
const THUMB_GAP = 8;
const RENDER_BUFFER = 2;

/** Same lazy-visible-window idea as the main page list, just at thumbnail
 * scale and with its own independent scroll position. */
export function PdfThumbnailSidebar({
  doc,
  pageSize,
  currentPage,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  pageSize: { width: number; height: number };
  currentPage: number;
  onSelect: (page: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ from: 1, to: Math.min(20, doc.numPages) });

  const thumbWidth = pageSize.width * THUMB_SCALE;
  const thumbHeight = pageSize.height * THUMB_SCALE;
  const rowHeight = thumbHeight + THUMB_GAP;

  function updateRange() {
    const el = scrollRef.current;
    if (!el) return;
    const first = Math.max(1, Math.floor(el.scrollTop / rowHeight) + 1 - RENDER_BUFFER);
    const last = Math.min(doc.numPages, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + RENDER_BUFFER);
    setRange({ from: first, to: last });
  }

  useEffect(() => {
    updateRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Keep the current page's thumbnail scrolled into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = (currentPage - 1) * rowHeight;
    if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - el.clientHeight / 2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  return (
    <div ref={scrollRef} className="pdf-thumbnail-sidebar" onScroll={updateRange}>
      <div className="pdf-thumbnail-list" style={{ height: doc.numPages * rowHeight, position: "relative" }}>
        {Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from + i).map((n) => (
          <button
            key={n}
            type="button"
            className={`pdf-thumbnail-btn${n === currentPage ? " active" : ""}`}
            style={{ position: "absolute", top: (n - 1) * rowHeight, left: 0, right: 0 }}
            onClick={() => onSelect(n)}
          >
            <PdfPageCanvas doc={doc} pageNumber={n} width={thumbWidth} height={thumbHeight} scale={THUMB_SCALE} shouldRender />
            <span className="pdf-thumbnail-label">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

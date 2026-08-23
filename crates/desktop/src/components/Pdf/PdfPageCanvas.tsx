import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "../../lib/pdfjs";

/** One page's slot in the scrollable page list. Always occupies its full
 * (scaled) size so the scrollbar/scroll math stays stable, but only
 * actually renders pixels onto its canvas while `shouldRender` is true —
 * scrolled-away pages get their canvas cleared, which is what keeps memory
 * from growing with document length instead of just with the visible
 * window. */
export function PdfPageCanvas({
  doc,
  pageNumber,
  width,
  height,
  scale,
  shouldRender,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  shouldRender: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport, canvas });
      renderTask = task;
      task.promise.catch(() => {
        // Cancelled or failed mid-render — nothing to show, nothing to do.
      });
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [doc, pageNumber, scale, shouldRender]);

  return (
    <div className="pdf-page" style={{ width, height }} data-page={pageNumber}>
      {shouldRender && <canvas ref={canvasRef} className="pdf-page-canvas" />}
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  );
}

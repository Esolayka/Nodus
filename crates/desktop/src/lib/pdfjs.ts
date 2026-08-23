import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Vite resolves this to a hashed asset URL at build time and serves it as-is
// in dev — the standard bundler-friendly way to point pdf.js at its worker
// without copying it into `public/` by hand.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).href;

const documentCache = new Map<string, Promise<PDFDocumentProxy>>();

/** Loads (and caches) a PDF document by its asset URL — pdf.js streams pages
 * on demand from the URL itself rather than pulling the whole file into
 * memory up front, which is what keeps a few-hundred-page document from
 * blowing up memory usage. */
export function loadPdfDocument(url: string): Promise<PDFDocumentProxy> {
  let cached = documentCache.get(url);
  if (!cached) {
    cached = pdfjsLib.getDocument({ url }).promise;
    documentCache.set(url, cached);
    cached.catch(() => documentCache.delete(url));
  }
  return cached;
}

export function forgetPdfDocument(url: string): void {
  documentCache.delete(url);
}

export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

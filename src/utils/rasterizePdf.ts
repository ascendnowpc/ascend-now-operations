import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

// pdf.js needs its worker script — bundled by Vite via the `new URL(...,
// import.meta.url)` pattern rather than a CDN, so this works offline/behind
// the app's own CSP.
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

// Renders every page of an uploaded PDF to an image, client-side, before the
// "parse an existing paper" flow uploads it. parse-homework-paper crops
// figures (pie charts, diagrams, graphs) straight out of the page pixels it's
// given — a raw PDF byte stream can't be decoded/cropped that way in the Deno
// edge runtime (ImageScript decodes raster images only), so a multi-page PDF
// is turned into one page-image upload per page here, exactly like a teacher
// photographing several pages already produces. Scale 2 (~144 DPI off pdf.js's
// 72 DPI baseline) keeps small print/figures legible for both Gemini's OCR and
// the later crop.
//
// JPEG, not PNG (post-deploy fix, 2026-07-14): a multi-page exam paper (e.g.
// 16 pages) was taking a long time to upload/parse. A big part of that was
// each rendered page going out as an uncompressed-ish PNG — several MB per
// page at this scale for a text-heavy exam page — which is slow both for the
// browser->Storage upload here and for the edge function's later
// Storage->Gemini re-upload of the same bytes. Pages are already rendered
// (not scanned) content, so JPEG's lossy compression costs essentially
// nothing visually for OCR/multimodal reading purposes while cutting file
// size dramatically — the same tradeoff a phone camera photo already makes.
const RENDER_SCALE = 2;
const PAGE_JPEG_QUALITY = 0.85;
// Mirrors parse-homework-paper's MAX_PARSE_FILES — the edge function rejects
// more uploaded pages than this outright, so it's surfaced as a real error
// here (see PdfPageLimitError) rather than silently rasterizing only the
// first 20 pages and dropping the rest without telling the teacher.
const MAX_PDF_PAGES = 20;

export class PdfPageLimitError extends Error {
  constructor(pageCount: number) {
    super(`This PDF has ${pageCount} pages — split it into parts of ${MAX_PDF_PAGES} pages or fewer.`);
    this.name = "PdfPageLimitError";
  }
}

export async function rasterizePdfToImages(file: File): Promise<File[]> {
  const buffer = await file.arrayBuffer();
  const loadingTask = getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new PdfPageLimitError(pdf.numPages);
    const pageCount = pdf.numPages;
    const baseName = file.name.replace(/\.pdf$/i, "") || "paper";
    const images: File[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get a 2D canvas context to render the PDF");

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Could not encode a PDF page as an image"))),
          "image/jpeg",
          PAGE_JPEG_QUALITY,
        ),
      );
      images.push(new File([blob], `${baseName}-page-${pageNum}.jpg`, { type: "image/jpeg" }));
      page.cleanup();
    }

    return images;
  } finally {
    await loadingTask.destroy();
  }
}

// Renders a PDF's pages to displayable image data URLs — used to VIEW a PDF
// in the browser (the whole-paper answer a student attaches, opened on the
// teacher's review page for annotation), as opposed to rasterizePdfToImages
// above which produces Files for upload. Takes a URL (e.g. a signed Supabase
// Storage URL) since that's how a private-bucket PDF is fetched client-side.
// No page cap here — this is read-only viewing of an already-accepted upload,
// not a new one being validated against MAX_PDF_PAGES.
const VIEW_SCALE = 1.5;

export async function renderPdfPagesToDataUrls(pdfUrl: string): Promise<string[]> {
  const loadingTask = getDocument({ url: pdfUrl });
  const pdf = await loadingTask.promise;
  try {
    const urls: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: VIEW_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get a 2D canvas context to render the PDF");

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      urls.push(canvas.toDataURL("image/jpeg", 0.85));
      page.cleanup();
    }
    return urls;
  } finally {
    await loadingTask.destroy();
  }
}

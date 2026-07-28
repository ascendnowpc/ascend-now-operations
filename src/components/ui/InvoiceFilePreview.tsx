function isImageUrl(url: string) {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
}

/** Inline preview for an uploaded invoice file — thumbnail for images, a file chip for PDFs/other. */
export function InvoiceFilePreview({ url, className = "" }: { url: string; className?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`block group ${className}`}>
      {isImageUrl(url) ? (
        <img
          src={url}
          alt="Invoice"
          className="rounded-lg border border-navy-100 max-h-56 w-full object-contain bg-navy-25 group-hover:border-sky-300 transition-colors"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-navy-100 bg-navy-25 px-3 py-2.5 group-hover:border-sky-300 transition-colors">
          <span className="text-xl leading-none">📄</span>
          <span className="text-sm text-sky-600 underline">View invoice file</span>
        </div>
      )}
    </a>
  );
}

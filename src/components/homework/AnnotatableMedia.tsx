import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Annotation } from "../../types/database";

const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;
const ZOOM_DEFAULT = 100; // "Fit" — the page fills the available reading width

// The comment margin sits beside each page at a fixed width. It's only shown
// when there's actually room for it (see `showMargin` below); when there isn't,
// comments fall back to a list beneath the page instead. The available width is
// MEASURED (ResizeObserver), and the page is sized to fit within it AFTER
// reserving the margin — so the page and its comments always fit together and
// the page is never pushed off-screen behind a horizontal scroll (the old bug:
// the page was rendered at the full reading width AND the margin was appended,
// forcing a scroll that hid the left of the page whenever you scrolled right to
// reach the comments).
//
// A pin dropped on the LEFT half of the page gets its card in a second, left-
// hand margin instead of piling every comment into the right margin regardless
// of where its pin actually is — otherwise a left-side pin's card ends up
// visually far from what it's pointing at, and the right margin gets crowded
// with cards for pins scattered across the whole page. The left margin only
// appears once there's actually a left-side pin/draft to show (see
// `needsLeftMargin` below) AND there's room for both margins at once — a page
// with every comment on the right (the common case) renders exactly as before.
const MARGIN_WIDTH_PX = 240; // w-60
const GAP_PX = 16; // gap-4 between the page and its margin
// Below this available width the (right) margin can't fit alongside a usable
// page, so comments drop to the list-below-the-page fallback instead.
const MARGIN_MIN_CONTAINER_PX = 700;
// A second (left) margin needs that same room again.
const DOUBLE_MARGIN_MIN_CONTAINER_PX = MARGIN_MIN_CONTAINER_PX + MARGIN_WIDTH_PX + GAP_PX;
// A pin's x% cutoff between "belongs in the left margin" and "belongs in the
// right margin" — simply which half of the page it was dropped on.
const LEFT_HALF_MAX_X = 50;

interface Props {
  images: string[]; // one per photo/page, already-resolved displayable URLs
  annotations: Annotation[];
  editable: boolean; // teacher reviewing = true; student/read-only display = false
  onChange?: (annotations: Annotation[]) => void;
  // Which field on Annotation indexes into `images` — a per-question photo
  // answer may have several photos (file_index); a whole-paper PDF has pages
  // (page). Both default to slot 0 if unset, so a single-image case just works.
  indexKey?: "file_index" | "page";
  // The natural reading width (px) to cap the page at when there's room — a
  // full-width PDF page renders uncomfortably huge on a wide screen. When set,
  // the anchored comment margin is offered (desktop) and the page is centred
  // and capped to this width at 100% zoom. When unset, the page simply fills
  // the available width (compact/embedded usage) and comments always use the
  // list fallback.
  readingWidthPx?: number;
}

interface CommentCardProps {
  text: string;
  active: boolean;
  editable: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

// One comment's card content — reused for both the margin (desktop, aligned
// beside its pin) and the fallback list (narrow screens, stacked below the
// page) so the two layouts never drift apart.
function CommentCard({ text, active, editable, onSelect, onRemove }: CommentCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border p-2 text-xs shadow-sm transition-colors ${
        active ? "border-sky-300 bg-sky-50" : "border-navy-100 bg-white hover:bg-navy-50/60"
      }`}
    >
      <p className="whitespace-pre-wrap text-navy-700">{text}</p>
      {editable && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="text-red-500 hover:underline"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

interface DraftCardProps {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

function DraftCard({ value, onChange, onCancel, onSave }: DraftCardProps) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="rounded-lg border border-sky-300 bg-sky-50 p-2 shadow-sm">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Add a comment…"
        className="w-full rounded border border-navy-100 bg-white px-2 py-1 text-xs text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-navy-400">
          Cancel
        </button>
        <button type="button" onClick={onSave} className="text-xs font-semibold text-lime-600">
          Add
        </button>
      </div>
    </div>
  );
}

// Click-anywhere-to-comment: click a page to drop a pin at that spot, then
// write the comment right there in the margin — Google-Docs style, where a
// comment sits at the same vertical position as what it's attached to,
// instead of a floating box anchored to the click point (which could run off
// the page edge) or a separate scrolling comment list disconnected from
// where the pin actually is. On narrow screens, where there's no room for a
// margin, comments fall back to a simple list below the page.
export function AnnotatableMedia({
  images,
  annotations,
  editable,
  onChange,
  indexKey = "page",
  readingWidthPx,
}: Props) {
  const [draft, setDraft] = useState<{ index: number; x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const listCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const listDraftRef = useRef<HTMLDivElement>(null);

  // The width actually available to lay out in — measured, so the page can be
  // sized to fit it (with room for the margin) rather than guessed. Starts at 0
  // and is set on mount by the layout effect below; the first paint renders
  // nothing sized wrong because pageWidthPx clamps to a sensible minimum.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Trackpad pinch-to-zoom: browsers report a two-finger trackpad pinch as a
  // wheel event with ctrlKey set (there's no standard cross-browser "pinch"
  // event outside Safari's non-standard gesture* events), so listening for
  // ctrlKey+wheel and resizing from it is the usual way to make pinch feel
  // native — the same trick Google Docs/Maps/Figma rely on. A plain two-finger
  // scroll (no ctrlKey) is left alone so the page still scrolls normally.
  // Attached as a native (non-passive) listener via a ref, not React's
  // onWheel, because React registers wheel/touch handlers as passive by
  // default and a passive listener can't call preventDefault().
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || images.length === 0) return;
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z - e.deltaY * 0.6))));
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [images.length]);

  // The margin (anchored comments beside the page) is only offered when a
  // reading width is given AND there's measured room for it.
  const wantMargin = readingWidthPx != null;
  const showMargin = wantMargin && containerW >= MARGIN_MIN_CONTAINER_PX;

  // The left margin is additional to the (right) margin above — only offered
  // when there's an actual left-side pin or draft to show, so a page with
  // everything on the right never reserves space it doesn't need.
  const needsLeftMargin =
    annotations.some((a) => a.x < LEFT_HALF_MAX_X) || (draft != null && draft.x < LEFT_HALF_MAX_X);
  const showLeftMargin = showMargin && needsLeftMargin && containerW >= DOUBLE_MARGIN_MIN_CONTAINER_PX;

  // Fit-first sizing: at 100% zoom the page fills the space available AFTER
  // reserving the margin(s), but never grows past its natural reading width.
  // Zoom scales up (or down) from that fit, and only then may the row exceed
  // the container and scroll — a deliberate user action, not the default.
  const marginsWidthPx =
    (showMargin ? MARGIN_WIDTH_PX + GAP_PX : 0) + (showLeftMargin ? MARGIN_WIDTH_PX + GAP_PX : 0);
  const availablePage = Math.max(120, containerW - marginsWidthPx);
  const basePage = wantMargin ? Math.min(readingWidthPx, availablePage) : availablePage;
  const pageWidthPx = Math.max(80, Math.round((basePage * zoom) / 100));
  const rowWidthPx = pageWidthPx + marginsWidthPx;

  // Reset zoom/selection when the actual displayed content changes (a
  // different submission/paper), not on every unrelated parent re-render —
  // images[0] + length is a cheap fingerprint that avoids joining a
  // possibly-huge array of base64 data URLs just to compare. Adjusted during
  // render (comparing against a mirrored key, resetting inline if it
  // differs) rather than in a useEffect, matching this codebase's existing
  // pattern for this exact situation (see HomeworkResultsList's filter
  // reset) — avoids an extra render with the previous content's state still
  // applied to the new content.
  const contentKey = `${images.length}:${images[0] ?? ""}`;
  const [resetForKey, setResetForKey] = useState(contentKey);
  if (contentKey !== resetForKey) {
    setResetForKey(contentKey);
    setZoom(ZOOM_DEFAULT);
    setActiveId(null);
    setDraft(null);
  }

  // Only the narrow-screen fallback list needs to scroll a card/draft into
  // view — the margin version is already positioned right beside its pin.
  useEffect(() => {
    if (draft) listDraftRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [draft]);

  function indexOf(a: Annotation): number {
    return indexKey === "file_index" ? (a.file_index ?? 0) : (a.page ?? 0);
  }

  function annotationsFor(index: number): Annotation[] {
    return annotations.filter((a) => indexOf(a) === index).sort((a, b) => a.y - b.y);
  }

  function handleImageClick(index: number, e: MouseEvent<HTMLDivElement>) {
    if (!editable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setDraft({ index, x, y });
    setDraftText("");
    setActiveId(null);
  }

  function saveDraft() {
    if (!draft || !draftText.trim() || !onChange) {
      setDraft(null);
      return;
    }
    const next: Annotation = {
      id: crypto.randomUUID(),
      x: draft.x,
      y: draft.y,
      text: draftText.trim(),
      ...(indexKey === "file_index" ? { file_index: draft.index } : { page: draft.index }),
    };
    onChange([...annotations, next]);
    setDraft(null);
    setDraftText("");
  }

  function removePin(id: string) {
    if (!onChange) return;
    onChange(annotations.filter((a) => a.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function selectPin(id: string) {
    setDraft(null);
    setActiveId((cur) => {
      const next = cur === id ? null : id;
      if (next) listCardRefs.current.get(next)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return next;
    });
  }

  return (
    <div ref={wrapRef} className="flex flex-col gap-3">
      {images.length > 0 && (
        <div className="flex items-center justify-end gap-2" title="Tip: pinch, or hold Ctrl/⌘ and scroll on the page, to resize with a trackpad">
          <span className="text-xs font-medium text-navy-400">Size</span>
          {/* A slider makes resizing effortless — drag to any size; the page
              and any comments always stay laid out to fit. A trackpad pinch
              (or Ctrl/⌘+scroll) does the same thing directly on the page —
              see the wheel listener above. */}
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Resize"
            className="h-1.5 w-28 cursor-pointer accent-sky-500"
          />
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
            disabled={zoom <= ZOOM_MIN}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-navy-100 text-sm font-semibold text-navy-600 hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="w-11 text-center text-xs font-medium text-navy-500">{zoom}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
            disabled={zoom >= ZOOM_MAX}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-navy-100 text-sm font-semibold text-navy-600 hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
          {zoom !== ZOOM_DEFAULT && (
            <button
              type="button"
              onClick={() => setZoom(ZOOM_DEFAULT)}
              className="ml-1 text-xs font-medium text-sky-600 hover:underline"
              title="Reset to a size that fits"
            >
              Fit
            </button>
          )}
        </div>
      )}

      {/* The scroll region is a safety net for when the user zooms the page
          bigger than the available width — at the default (fit) size the row
          (page + margin) already fits, so it's centred with no scroll and
          nothing is clipped. */}
      <div className="overflow-x-auto">
        <div className="mx-auto" style={{ width: rowWidthPx }}>
          {images.map((src, i) => {
            const pageAnnotations = annotationsFor(i);
            const leftAnnotations = showLeftMargin
              ? pageAnnotations.filter((a) => a.x < LEFT_HALF_MAX_X)
              : [];
            const rightAnnotations = showLeftMargin
              ? pageAnnotations.filter((a) => a.x >= LEFT_HALF_MAX_X)
              : pageAnnotations;
            const draftOnThisPage = draft && draft.index === i;
            const draftInLeftMargin = !!draftOnThisPage && showLeftMargin && draft!.x < LEFT_HALF_MAX_X;
            const draftInRightMargin = !!draftOnThisPage && !draftInLeftMargin;
            return (
              <div key={i} className="mb-4 last:mb-0">
                <div className="flex items-stretch" style={{ gap: showMargin ? GAP_PX : 0 }}>
                  {/* Left margin — only when there's an actual left-side pin or
                      draft to show (see showLeftMargin above). Same anchored-
                      at-y% treatment as the right margin below. */}
                  {showLeftMargin && (
                    <div className="relative shrink-0" style={{ width: MARGIN_WIDTH_PX }}>
                      {leftAnnotations.map((a) => (
                        <div key={a.id} style={{ top: `${a.y}%` }} className="absolute inset-x-0 -translate-y-1/2">
                          <CommentCard
                            text={a.text}
                            active={activeId === a.id}
                            editable={editable}
                            onSelect={() => selectPin(a.id)}
                            onRemove={() => removePin(a.id)}
                          />
                        </div>
                      ))}
                      {draftInLeftMargin && (
                        <div style={{ top: `${draft!.y}%` }} className="absolute inset-x-0 -translate-y-1/2">
                          <DraftCard
                            value={draftText}
                            onChange={setDraftText}
                            onCancel={() => setDraft(null)}
                            onSave={saveDraft}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Outer card gives the image visible breathing room (border +
                      padding) instead of the image butting straight against the
                      card edge. The click/pin math below is all relative to the
                      INNER box, which tightly wraps the image with no padding
                      of its own, so pin positions stay pixel-accurate — only
                      the decorative frame lives on the outer box. */}
                  <div
                    className="shrink-0 rounded-lg border border-navy-100 bg-white p-3"
                    style={{ width: pageWidthPx }}
                  >
                    <div
                      onClick={(e) => handleImageClick(i, e)}
                      className={`relative overflow-hidden rounded ${editable ? "cursor-crosshair" : ""}`}
                    >
                      <img src={src} alt={`Page ${i + 1}`} className="block w-full select-none" draggable={false} />

                      {pageAnnotations.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectPin(a.id);
                          }}
                          style={{ left: `${a.x}%`, top: `${a.y}%` }}
                          className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold text-navy-800 shadow ring-2 ring-white ${
                            activeId === a.id ? "bg-sky-400 hover:bg-sky-300" : "bg-lime-400 hover:bg-lime-300"
                          }`}
                          aria-label="Comment"
                        >
                          !
                        </button>
                      ))}

                      {draft && draft.index === i && (
                        <span
                          style={{ left: `${draft.x}%`, top: `${draft.y}%` }}
                          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow"
                          aria-hidden
                        />
                      )}
                    </div>
                  </div>

                  {/* Right margin — only when there's measured room (showMargin).
                      Each card sits at `top: y%`, the exact same percentage used
                      for its pin, so it lines up on the same line as what it's
                      commenting on. Holds every pin/draft NOT routed to the left
                      margin above. When there's no room at all, comments use the
                      list fallback below instead. */}
                  {showMargin && (
                    <div className="relative shrink-0" style={{ width: MARGIN_WIDTH_PX }}>
                      {rightAnnotations.map((a) => (
                        <div key={a.id} style={{ top: `${a.y}%` }} className="absolute inset-x-0 -translate-y-1/2">
                          <CommentCard
                            text={a.text}
                            active={activeId === a.id}
                            editable={editable}
                            onSelect={() => selectPin(a.id)}
                            onRemove={() => removePin(a.id)}
                          />
                        </div>
                      ))}
                      {draftInRightMargin && (
                        <div style={{ top: `${draft!.y}%` }} className="absolute inset-x-0 -translate-y-1/2">
                          <DraftCard
                            value={draftText}
                            onChange={setDraftText}
                            onCancel={() => setDraft(null)}
                            onSave={saveDraft}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* List fallback — used whenever the margin isn't shown. */}
                {!showMargin && (pageAnnotations.length > 0 || draftOnThisPage) && (
                  <div className="mt-2 flex flex-col gap-2">
                    {draftOnThisPage && (
                      <div ref={listDraftRef}>
                        <DraftCard
                          value={draftText}
                          onChange={setDraftText}
                          onCancel={() => setDraft(null)}
                          onSave={saveDraft}
                        />
                      </div>
                    )}
                    {pageAnnotations.map((a) => (
                      <div
                        key={a.id}
                        ref={(el) => {
                          if (el) listCardRefs.current.set(a.id, el);
                          else listCardRefs.current.delete(a.id);
                        }}
                      >
                        <CommentCard
                          text={a.text}
                          active={activeId === a.id}
                          editable={editable}
                          onSelect={() => selectPin(a.id)}
                          onRemove={() => removePin(a.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

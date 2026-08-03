import { ProfileIcon } from "./profileIcons";
import type { PcCardEntry, PcProfile } from "../../types/database";

// The performance coach's "about me" profile students see on the My PC tab.
// The photo/name header and the Performance Coach timeline sit directly on
// the page (no card chrome); About and Performing Achievements stay boxed.
// Education is a separate component (PcEducationSidebar) — composed with
// this one by PcProfileWithEducation below as an independent right sidebar,
// not squeezed into the same column. Every section renders only when it has
// content, so a half-filled profile still looks intentional rather than
// showing empty headings. Colors stick to the site's own navy/sky/lime theme
// (tailwind.config.js) — no one-off hues.

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[13px] leading-snug text-navy-600">
      <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5 mt-[3px] shrink-0 text-sky-500">
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 10.5l2.5 2.5L14 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

// A "label: value" row, matching the reference profile card's info rows.
// Exported so a custom header (e.g. the coach's own editable personal-info
// header) can match the same look.
export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="text-[14px] leading-relaxed">
      <span className="text-navy-400">{label}: </span>
      <span className="text-navy-700 font-semibold">{value}</span>
    </p>
  );
}

// Theme-only tints cycled across achievement boxes.
const ACHIEVEMENT_TINTS = ["bg-sky-50", "bg-lime-50", "bg-navy-50"];

// A single stop on the "Performance Coach" horizontal timeline: a node icon,
// a number, a heading, and a short line of text — alternating above/below a
// shared horizontal line like a roadmap.
function TimelineStop({ entry, index, side }: { entry: PcCardEntry; index: number; side: "top" | "bottom" }) {
  const node = (
    <div className="w-11 h-11 rounded-full bg-sky-500 flex items-center justify-center shrink-0">
      <ProfileIcon icon={entry.icon} className="w-5 h-5 text-white" />
    </div>
  );
  const stem = <div className="w-px h-6 bg-sky-200" />;
  const content = (
    <div className="px-1">
      <span className="text-sky-500 font-extrabold text-base">{index + 1}.</span>
      {entry.heading && <p className="text-[15px] font-bold text-navy-800 leading-snug mt-0.5">{entry.heading}</p>}
      {entry.text && <p className="text-[12.5px] text-navy-500 leading-snug mt-0.5">{entry.text}</p>}
    </div>
  );

  return (
    <div className="flex flex-col items-center text-center gap-2">
      {side === "top" ? (
        <>
          {node}
          {content}
          {stem}
        </>
      ) : (
        <>
          {stem}
          {content}
          {node}
        </>
      )}
    </div>
  );
}

// The horizontal roadmap: two grids (stops above / stops below the line)
// straddling a shared dotted line, all sized off the same column count so
// the connecting stems line up. Scrolls horizontally on narrow screens
// rather than squeezing the columns.
function ResponsibilityTimeline({ entries }: { entries: PcCardEntry[] }) {
  const n = entries.length;
  const columns = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  const minWidth = Math.max(640, n * 180);

  return (
    <div className="overflow-x-auto w-full min-w-0">
      <div style={{ minWidth: `${minWidth}px` }}>
        <div className="grid items-end" style={columns}>
          {entries.map((entry, i) =>
            i % 2 === 1 ? <TimelineStop key={i} entry={entry} index={i} side="top" /> : <div key={i} />
          )}
        </div>
        <div className="grid" style={columns}>
          {entries.map((_, i) => (
            <div key={i} className="relative h-3 flex items-center justify-center">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-sky-200" />
              <span className="relative z-10 w-2.5 h-2.5 rounded-full bg-sky-500" />
            </div>
          ))}
        </div>
        <div className="grid items-start" style={columns}>
          {entries.map((entry, i) =>
            i % 2 === 0 ? <TimelineStop key={i} entry={entry} index={i} side="bottom" /> : <div key={i} />
          )}
        </div>
      </div>
    </div>
  );
}

export function PcProfileCard({
  profile,
  coachName,
  header,
  roleTitle = "Performance Coach",
  showClosingImage = true,
}: {
  profile: PcProfile;
  coachName: string;
  // Overrides the default photo/name/contact header — used by the coach's
  // own merged profile page to show their editable personal info in the
  // same spot instead of the admin-set public contact fields. Omit for the
  // default header (student/admin views); pass null to render no header at
  // all (the merged page renders its own header above this component).
  header?: React.ReactNode | null;
  // The heading over the responsibilities timeline, and the fallback name.
  // `pc_profiles` backs both roles, so a College Counsellor's card is this
  // same component with "College Counsellor" here.
  roleTitle?: string;
  // The stock closing photo is part of the coach's card only — a counsellor's
  // card ends after their content (see StudentMyCcPage).
  showClosingImage?: boolean;
}) {
  const name = coachName || roleTitle;
  const achievements = profile.achievements ?? [];
  const responsibilities = profile.coach_responsibilities ?? [];

  return (
    <div className="flex flex-col gap-5">
      {header === undefined ? (
        /* ── Photo + info — no card chrome, sits directly on the page ── */
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="shrink-0">
            {profile.photo_url ? (
              <img
                src={profile.photo_url}
                alt={name}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover ring-4 ring-sky-50"
              />
            ) : (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-sky-50 ring-4 ring-sky-50 flex items-center justify-center">
                <span className="text-2xl font-bold text-sky-500">{initialsOf(name)}</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            {profile.department && (
              <span className="inline-block bg-sky-100 text-navy-700 text-[10px] font-semibold px-2 py-0.5 rounded mb-1.5">
                {profile.department}
              </span>
            )}
            <h2 className="text-xl sm:text-2xl font-extrabold text-navy-800 truncate">{name}</h2>
            <div className="mt-3 flex flex-col gap-1">
              {profile.contact_email && (
                <InfoRow
                  label="Email"
                  value={
                    <a href={`mailto:${profile.contact_email}`} className="hover:text-sky-600">
                      {profile.contact_email}
                    </a>
                  }
                />
              )}
              {profile.contact_phone && <InfoRow label="Phone" value={profile.contact_phone} />}
            </div>
          </div>
        </div>
      ) : (
        header
      )}

      {/* ── About ── */}
      {profile.about && (
        <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5 sm:p-6">
          <span className="inline-block bg-yellow-100 text-navy-700 text-[12px] font-bold px-2.5 py-0.5 rounded-full mb-2">
            Hi there! Here's a little bit about me…
          </span>
          <div className="text-[14.5px] text-navy-600 leading-relaxed whitespace-pre-line">{profile.about}</div>
        </div>
      )}

      {/* ── Responsibilities — timeline, no card chrome ── */}
      {responsibilities.length > 0 && (
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 mb-5">
            <h3 className="text-[17px] font-extrabold text-navy-700">{roleTitle}</h3>
            <span className="text-sky-500 font-bold tracking-[0.16em] text-[11px] uppercase shrink-0">Ascend Now</span>
          </div>
          <ResponsibilityTimeline entries={responsibilities} />
        </div>
      )}

      {/* ── Performing Achievements ── */}
      {achievements.length > 0 && (
        <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5 sm:p-6">
          <h3 className="text-[17px] font-extrabold text-navy-700 mb-3">Performing Achievements</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {achievements.map((a, i) => (
              <div key={i} className={`rounded-xl p-3.5 ${ACHIEVEMENT_TINTS[i % ACHIEVEMENT_TINTS.length]}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-extrabold text-navy-800 truncate">{a.student_name}</p>
                    {a.subject && (
                      <span className="inline-block bg-white/70 text-navy-700 text-[11.5px] font-semibold px-1.5 py-0.5 rounded mt-1">
                        {a.subject}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const logos = a.institution_logo_urls?.length
                      ? a.institution_logo_urls
                      : a.institution_logo_url
                        ? [a.institution_logo_url]
                        : [];
                    if (logos.length > 0) {
                      return (
                        <div className="flex items-center gap-2 shrink-0">
                          {logos.map((src, k) => (
                            <img
                              key={k}
                              src={src}
                              alt={a.institutions || a.student_name}
                              className="h-12 w-auto max-w-[96px] object-contain"
                            />
                          ))}
                        </div>
                      );
                    }
                    return (
                      a.institutions && (
                        <span className="text-[11.5px] font-semibold text-navy-400 text-right shrink-0">{a.institutions}</span>
                      )
                    );
                  })()}
                </div>
                {(a.score_before || a.score_after) && (
                  <div className="flex items-end gap-1 mt-2">
                    {a.score_before ? (
                      <>
                        <span className="text-xl font-extrabold text-navy-800 leading-none">{a.score_before}</span>
                        {a.score_scale && <span className="text-navy-400 text-[11.5px]">/{a.score_scale}</span>}
                        <span className="text-sky-500 text-base leading-none mx-0.5">➜</span>
                        <span className="text-xl font-extrabold text-sky-500 leading-none">{a.score_after || "—"}</span>
                        {a.score_scale && <span className="text-navy-400 text-[11.5px]">/{a.score_scale}</span>}
                      </>
                    ) : (
                      <>
                        <span className="text-xl font-extrabold text-sky-500 leading-none">{a.score_after}</span>
                        {a.score_scale && <span className="text-navy-400 text-[11.5px]">/{a.score_scale}</span>}
                      </>
                    )}
                  </div>
                )}
                {a.helped.length > 0 && (
                  <>
                    <span className="inline-block bg-white/70 text-navy-700 text-[11.5px] font-semibold px-1.5 py-0.5 rounded mt-2.5 mb-1.5">
                      How we helped
                    </span>
                    <ul className="space-y-1">
                      {a.helped.map((h, j) => (
                        <CheckItem key={j}>{h}</CheckItem>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* —─ Closing image — sits at the very end of the profile —─ */}
      {showClosingImage && (
        <div className="rounded-2xl overflow-hidden">
          <img src="/pcstudent.jpg" alt="" className="w-full h-auto object-cover" />
        </div>
      )}
    </div>
  );
}

// The Education box on its own — vertically stacked entries. Rendered as an
// independent sidebar by PcProfileWithEducation below, not squeezed into the
// main card's own column.
export function PcEducationSidebar({ education }: { education: PcCardEntry[] }) {
  if (education.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-4">
      <h3 className="text-[17px] font-extrabold text-navy-700 mb-3">Education</h3>
      <div className="flex flex-col gap-3">
        {education.map((e, i) => (
          <div key={i} className="rounded-xl bg-navy-50 p-3.5 flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0">
              <ProfileIcon icon={e.icon} />
            </div>
            <div className="min-w-0">
              {e.heading && <p className="text-[15px] font-bold text-navy-800 leading-snug">{e.heading}</p>}
              {e.text && <p className="text-[13px] text-navy-500 leading-snug mt-0.5">{e.text}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Composes the main card with Education as a genuinely separate right
// sidebar — a plain flex sibling, not a column squeezed into the card's own
// width. The row centers the whole (card + sidebar) block as a unit
// (lg:justify-center) rather than pinning it to the left and dumping all
// leftover space on the right — that read as broken (barely any gap on the
// left, a huge dead zone on the right). Centering the block splits leftover
// space evenly on both sides while gap-6 keeps the sidebar snug against the
// card regardless of viewport width (justify-content never inserts space
// *between* items, only around the packed group). This is the same
// whether or not Education is present, so the card never jumps to a
// different position depending on a coach's data. The card still grows up
// to max-w-3xl before stopping (min-w-0 lets it shrink instead of
// overflowing on a narrower screen). Below lg there's rarely room for both
// side by side, so it stacks instead.
export function PcProfileWithEducation({
  profile,
  coachName,
  roleTitle,
  showClosingImage,
}: {
  profile: PcProfile;
  coachName: string;
  roleTitle?: string;
  showClosingImage?: boolean;
}) {
  const education = profile.education ?? [];

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:justify-center lg:items-start">
      <div className="max-w-3xl w-full mx-auto lg:mx-0 lg:flex-1 lg:min-w-0">
        <PcProfileCard
          profile={profile}
          coachName={coachName}
          roleTitle={roleTitle}
          showClosingImage={showClosingImage}
        />
      </div>
      {education.length > 0 && (
        <div className="w-full lg:w-96 lg:shrink-0">
          <PcEducationSidebar education={education} />
        </div>
      )}
    </div>
  );
}

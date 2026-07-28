import { useMemo, useState } from "react";
import type { SessionLog } from "../../types/database";

interface Props {
  logs: SessionLog[];
  loading: boolean;
  subjectName: (id: number | null) => string | null;
  curriculumName: (id: number | null) => string | null;
  value: number | "";
  onChange: (id: number | "") => void;
}

// A rich, filterable session-log picker for the Homework Generator. Unlike a
// bare <select>, it surfaces everything a teacher needs to recognise a session
// (subject, curriculum, topic, duration, engagement, flag, summary snippet) and
// lets them narrow the list by subject, date range and a free-text search before
// picking one.
export function SessionLogPicker({
  logs,
  loading,
  subjectName,
  curriculumName,
  value,
  onChange,
}: Props) {
  const [subjectFilter, setSubjectFilter] = useState<number | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  // Subjects present in this student's logs — the only ones worth offering.
  const subjectOptions = useMemo(() => {
    const ids = new Map<number, string>();
    for (const l of logs) {
      if (l.subject_id != null) {
        const name = subjectName(l.subject_id);
        if (name) ids.set(l.subject_id, name);
      }
    }
    return [...ids.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [logs, subjectName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (subjectFilter !== "" && l.subject_id !== subjectFilter) return false;
      if (dateFrom && l.session_date < dateFrom) return false;
      if (dateTo && l.session_date > dateTo) return false;
      if (q) {
        const hay = `${l.topic ?? ""} ${l.fathom_summary ?? ""} ${subjectName(l.subject_id) ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, subjectFilter, dateFrom, dateTo, search, subjectName]);

  const hasActiveFilters = subjectFilter !== "" || dateFrom || dateTo || search.trim();

  if (loading) return <p className="text-sm text-navy-300">Loading sessions…</p>;
  if (logs.length === 0)
    return (
      <p className="text-sm text-amber-600">
        No session logs found for this student under your account.
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-navy-400">Subject</label>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value ? Number(e.target.value) : "")}
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            <option value="">All subjects</option>
            {subjectOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-navy-400">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-navy-400">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[10rem]">
          <label className="text-[11px] font-medium text-navy-400">Search topic / summary</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. quadratics"
            className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSubjectFilter("");
              setDateFrom("");
              setDateTo("");
              setSearch("");
            }}
            className="rounded-pill px-3 py-1.5 text-xs font-semibold text-navy-500 hover:bg-navy-50"
          >
            Clear
          </button>
        )}
      </div>

      <p className="text-[11px] text-navy-400">
        {filtered.length} of {logs.length} session{logs.length === 1 ? "" : "s"}
      </p>

      {/* Selectable list */}
      {filtered.length === 0 ? (
        <p className="text-sm text-navy-300">No sessions match these filters.</p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
          {filtered.map((l) => {
            const selected = l.id === value;
            const subj = subjectName(l.subject_id);
            const curr = curriculumName(l.curriculum_id);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => onChange(selected ? "" : l.id)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    selected
                      ? "border-sky-400 bg-sky-50/70 ring-1 ring-sky-300"
                      : "border-navy-50 hover:border-navy-200 hover:bg-navy-50/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-navy-700">
                      {l.session_date}
                      {subj ? ` · ${subj}` : ""}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {l.flag_for_coach && (
                        <span className="rounded-pill px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">
                          Flagged
                        </span>
                      )}
                      {l.engagement_rating && (
                        <span
                          className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                            l.engagement_rating === "high"
                              ? "bg-lime-200 text-navy-700"
                              : l.engagement_rating === "medium"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-navy-100 text-navy-500"
                          }`}
                        >
                          {l.engagement_rating}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-navy-500">
                    {curr ? `${curr}` : ""}
                    {curr && l.topic ? " · " : ""}
                    {l.topic ? l.topic : !curr ? "No topic recorded" : ""}
                    {l.session_duration_hrs != null ? ` · ${l.session_duration_hrs}h` : ""}
                  </p>
                  {l.fathom_summary && (
                    <p className="mt-1 text-xs text-navy-400 line-clamp-2">{l.fathom_summary}</p>
                  )}
                  {!l.fathom_summary && (
                    <p className="mt-1 text-[11px] italic text-amber-500">
                      No session summary recorded — generation will lean on the topic and feedback
                      notes only.
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

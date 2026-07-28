import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Spinner } from "../ui/Spinner";
import { Button } from "../ui/Button";
import { CoordinatorLogSections } from "./CoordinatorLogSections";
import { useStudentCoordinatorLogs, fetchCoordinatorLogById } from "../../hooks/useCoordinatorLogs";
import type { CoordinatorLog, CoordinatorLogSubject, CoordinatorLogPackageStatus } from "../../types/database";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Student-detail "Coordinator's Log" tab — shows the latest check-in in full,
// with "Show all logs" deep-linking to the Coordinator's Log list filtered to
// this student.
export function CoordinatorLogHistoryList({
  studentId,
  addLogPath,
  listPath,
  canAdd = true,
}: {
  studentId: string | undefined;
  addLogPath: string;
  listPath: string;
  canAdd?: boolean;
}) {
  const { logs, loading } = useStudentCoordinatorLogs(studentId);
  const [full, setFull] = useState<(CoordinatorLog & { subjects: CoordinatorLogSubject[]; package_statuses: CoordinatorLogPackageStatus[] }) | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const latestId = logs[0]?.id;

  // The date this student's PC first filed a log by hand — excludes the
  // automatic per-package renewal snapshots (is_automated). logs is ordered
  // newest-first, so the earliest manual one is the last in that filtered list.
  const manualLogs = logs.filter((l) => !l.is_automated);
  const firstManualLog = manualLogs.length > 0 ? manualLogs[manualLogs.length - 1] : null;

  useEffect(() => {
    if (!latestId) { setFull(null); return; }
    let cancelled = false;
    setLoadingFull(true);
    fetchCoordinatorLogById(latestId).then(({ data }) => {
      if (cancelled) return;
      setFull(data ?? null);
      setLoadingFull(false);
    });
    return () => { cancelled = true; };
  }, [latestId]);

  if (!studentId) return null;
  if (loading) return <Spinner />;

  if (logs.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-navy-400">No logs yet.</p>
        {canAdd && (
          <Link to={`${addLogPath}?student=${studentId}`} className="self-start">
            <Button size="sm">Update Performance Coach Log</Button>
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide">Latest — {formatDate(logs[0].log_date)}</p>
          <p className="text-xs text-navy-400">
            First logged by Performance Coach — {firstManualLog ? formatDate(firstManualLog.log_date) : "not yet"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`${listPath}?student=${studentId}`}>
            <Button size="sm" variant="secondary">Show all logs</Button>
          </Link>
          {canAdd && (
            <Link to={`${addLogPath}?student=${studentId}`}>
              <Button size="sm">Update Performance Coach Log</Button>
            </Link>
          )}
        </div>
      </div>

      {loadingFull || !full ? <Spinner /> : <CoordinatorLogSections log={full} />}
    </div>
  );
}

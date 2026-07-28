import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../layout/PageHeader";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { CoordinatorLogSections } from "./CoordinatorLogSections";
import { fetchCoordinatorLogById, deleteCoordinatorLogById } from "../../hooks/useCoordinatorLogs";
import type { CoordinatorLog, CoordinatorLogSubject, CoordinatorLogPackageStatus } from "../../types/database";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function CoordinatorLogDetailView({
  backListPath,
}: {
  backListPath: string;
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<(CoordinatorLog & { subjects: CoordinatorLogSubject[]; package_statuses: CoordinatorLogPackageStatus[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchCoordinatorLogById(Number(id)).then(({ data, error }) => {
      if (error || !data) { setError(error ?? "Log not found."); setLoading(false); return; }
      setLog(data);
      setLoading(false);
    });
  }, [id]);

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    const { error } = await deleteCoordinatorLogById(Number(id));
    setDeleting(false);
    if (error) { setError(error); setConfirmOpen(false); return; }
    navigate(backListPath);
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-navy-300"><Spinner /> Loading…</div>;
  }
  if (error || !log) {
    return <p className="text-sm text-red-600">{error ?? "Log not found."}</p>;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Performance Coach Log"
        description={formatDate(log.log_date)}
        action={
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>Delete</Button>
          </div>
        }
      />

      <CoordinatorLogSections log={log} />

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this log?"
        description="This can't be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

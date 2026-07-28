import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/submit-payment-proof`;

interface InvoicePackage {
  hours: number;
  package_size_label: string;
  course_types: { name: string } | null;
}

interface InvoiceInfo {
  enrollment_type: "new_student" | "renewal";
  first_name: string;
  last_name: string;
  parent_full_name: string | null;
  note: string | null;
  status: "pending_payment" | "payment_submitted" | "confirmed" | "rejected";
  rejection_reason: string | null;
  packages: InvoicePackage[];
  proof_count: number;
}

// This page has no Supabase Auth session — parents reach it via an emailed
// link with no login. The unguessable token in the URL is the only access
// control, enforced server-side by the submit-payment-proof edge function.
export default function PublicPaymentPage() {
  const { token } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<InvoiceInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Multiple files can be picked at once (paid all in one go — one
  // screenshot) or added one at a time (paid in separate transactions —
  // several screenshots) before hitting Upload; either way they all go up
  // together in a single submission.
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${FUNCTION_URL}?token=${encodeURIComponent(token)}`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        const body = await res.json();
        if (!res.ok) { setLoadError(body.error ?? "This payment link is invalid or has expired."); return; }
        setInvoice(body.data);
      } catch {
        setLoadError("Couldn't reach the server. Please check your connection and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    // Snapshot into a plain array synchronously, right now — `picked` is
    // the input's live `files` list, and the input is reset (`value = ""`)
    // right after this call returns, which also empties `.files`. The
    // setFiles updater below only runs later, so if it read `picked`
    // itself (instead of this snapshot) it would find an already-emptied
    // list and silently add nothing — exactly reproduced by an automated
    // click-through of this flow.
    const snapshot = Array.from(picked);
    setFiles((prev) => [...prev, ...snapshot]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (!token || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    // A large screenshot (or several) on a slow connection could otherwise
    // hang indefinitely with no feedback — the button stuck on "Uploading…"
    // and effectively unclickable. Aborting after a generous timeout
    // guarantees the button always comes back with a clear, actionable
    // message instead of hanging forever.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const form = new FormData();
      form.append("token", token);
      for (const file of files) form.append("file", file);
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: form,
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok) { setUploadError(body.error ?? "Upload failed"); return; }
      setUploaded(true);
    } catch (err) {
      setUploadError(
        err instanceof DOMException && err.name === "AbortError"
          ? "Upload timed out — this can happen with a large file on a slow connection. Please try again."
          : "Couldn't reach the server. Please check your connection and try again."
      );
    } finally {
      clearTimeout(timeoutId);
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-25 flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md p-6">
        <div className="mb-6 flex justify-center">
          <img src="/logo.png" alt="AscendNow" className="h-9 w-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>

        {loading ? (
          <p className="text-sm text-navy-400 text-center py-8">Loading…</p>
        ) : loadError ? (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{loadError}</p>
        ) : invoice ? (
          <>
            <h1 className="text-lg font-bold text-navy-700 mb-1">
              {invoice.enrollment_type === "new_student" ? "New Enrollment" : "Package Renewal"}
            </h1>
            <p className="text-sm text-navy-400 mb-5">{invoice.first_name} {invoice.last_name}</p>

            <div className="rounded-xl border border-navy-50 bg-slate-50/60 p-4 mb-5 text-sm divide-y divide-navy-100/60">
              {invoice.packages.map((pkg, i) => (
                <div key={i} className="flex justify-between py-1.5 gap-4 first:pt-0 last:pb-0">
                  <span className="text-navy-400">{invoice.packages.length > 1 ? `Package ${i + 1}` : "Package"}</span>
                  <span className="font-medium text-navy-700 text-right">{pkg.course_types?.name ?? "Package"} — {pkg.package_size_label} ({pkg.hours} hrs)</span>
                </div>
              ))}
              {invoice.note && <div className="flex justify-between py-1.5 gap-4"><span className="text-navy-400 shrink-0">Note</span><span className="text-navy-700 text-right">{invoice.note}</span></div>}
            </div>

            {invoice.status === "confirmed" ? (
              <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2.5">✓ Payment confirmed — check your email for confirmation{invoice.enrollment_type === "new_student" ? " and your dashboard login details" : ""}.</p>
            ) : invoice.status === "payment_submitted" ? (
              <p className="text-sm text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2.5">Your payment proof ({invoice.proof_count} screenshot{invoice.proof_count === 1 ? "" : "s"}) has been submitted and is awaiting review. You'll receive a confirmation email once it's verified.</p>
            ) : uploaded ? (
              <p className="text-sm text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2.5">Thanks! Your payment proof has been submitted and is awaiting review.</p>
            ) : (
              <>
                {invoice.status === "rejected" && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4">
                    Your last submission couldn't be verified{invoice.rejection_reason ? `: ${invoice.rejection_reason}` : "."} Please re-upload below.
                  </p>
                )}
                <p className="text-sm text-navy-500 mb-3">
                  Once you've made payment, upload a screenshot of your payment confirmation below — add one file if you paid it all in one go, or several if you paid in separate transactions.
                </p>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                  className="w-full text-sm text-navy-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sky-700 file:font-medium mb-3"
                />
                {files.length > 0 && (
                  <ul className="mb-4 flex flex-col gap-1.5">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-lg border border-navy-50 bg-slate-50/60 px-3 py-1.5 text-xs text-navy-600">
                        <span className="truncate">{f.name}</span>
                        <button type="button" onClick={() => removeFile(i)} className="text-navy-400 hover:text-red-500 shrink-0 ml-2">Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                {uploadError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{uploadError}</p>}
                <Button onClick={handleUpload} disabled={files.length === 0 || uploading} className="w-full">
                  {uploading ? "Uploading…" : `Upload ${files.length > 1 ? `${files.length} Screenshots` : "Payment Proof"}`}
                </Button>
              </>
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
}

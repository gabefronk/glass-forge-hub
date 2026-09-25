import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { sanitizeText } from "@/lib/jobsSanitize";
import { canReadJobDocuments } from "../../../base44/shared/jobDocumentsAccess.mjs";
import { Row } from "@/components/jobs/JobContacts";

// The full job rail and Jobs list panel share the same verified folder and file list.
// Read access is currently for signed-in Hub users; link writes use the shared access predicate.
export default function JobDriveDocuments({ job, compact = false }) {
  const { user } = useAuth();
  const canRead = canReadJobDocuments(user);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setResult(null); setError("");
    if (!canRead || !job?.id) return;
    let active = true;
    setBusy(true);
    base44.functions.invoke("job-documents", { action: "list", job_id: job.id })
      .then(r => { if (!active) return; if (r.data?.error) throw Error(r.data.error); setResult(r.data); })
      .catch(e => { if (active) setError(e.message || "Drive files unavailable."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [job?.id, job?.drive_job_folder_id, canRead]);
  if (!canRead || !job?.id) return null;
  if (!busy && !error && !result?.folder) return null;
  const content = <div className="space-y-2 text-xs">
    {result?.folder?.url && <p><a href={result.folder.url} target="_blank" rel="noreferrer" className="underline">Open verified job folder</a></p>}
    {busy && <p>Loading current files…</p>}
    {error && <p role="alert">{error}</p>}
    {result?.files?.length > 0 && <ul className="space-y-1">{result.files.map(f => <li key={f.id}><a className="break-all underline" href={f.url} target="_blank" rel="noreferrer">{sanitizeText(f.name)}</a></li>)}</ul>}
    {result && !result.files.length && <p>No files in this folder's top level.</p>}
    {result && !result.complete && <p>File list is partial. Open the folder for the full set.</p>}
  </div>;
  return compact ? <div className="mt-3 rounded-lg border p-3"><div className="mb-2 text-xs font-semibold">Drive job folder</div>{content}</div> : <Row icon={FileText} label="Drive job folder">{content}</Row>;
}

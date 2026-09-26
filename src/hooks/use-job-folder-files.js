import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { canReadJobDocuments } from "../../base44/shared/jobDocumentsAccess.mjs";

// Read-only listing of the job's linked Drive folder, through the same
// job-documents "list" action JobDriveDocuments uses. Nothing here links,
// unlinks or writes; the folder connection itself is left untouched.
export function useJobFolderFiles(job, refreshKey = 0) {
  const { user } = useAuth();
  const canRead = canReadJobDocuments(user);
  const [state, setState] = useState({ loading: false, folder: null, files: [], complete: true, error: "" });
  useEffect(() => {
    if (!canRead || !job?.id) { setState({ loading: false, folder: null, files: [], complete: true, error: "" }); return; }
    if (!job.drive_job_folder_id) { setState({ loading: false, folder: null, files: [], complete: true, error: "" }); return; }
    let active = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    base44.functions.invoke("job-documents", { action: "list", job_id: job.id })
      .then((r) => {
        if (!active) return;
        if (r.data?.error) throw Error(r.data.error);
        setState({ loading: false, folder: r.data?.folder || null, files: r.data?.files || [], complete: r.data?.complete !== false, error: "" });
      })
      .catch((e) => { if (active) setState((s) => ({ ...s, loading: false, error: e.message || "Drive files unavailable." })); });
    return () => { active = false; };
  }, [job?.id, job?.drive_job_folder_id, canRead, refreshKey]);
  return { ...state, canRead };
}

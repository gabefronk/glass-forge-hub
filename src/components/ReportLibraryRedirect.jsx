import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";

// Old /report-library URLs now fold into Jobs. If a job id is supplied (or a
// saved project with a linked job), open that job directly; otherwise go to Jobs.
export default function ReportLibraryRedirect() {
  const [params] = useSearchParams();
  const [to, setTo] = useState(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const jobId = params.get("job");
      if (jobId) { if (!canceled) setTo(`/jobs/${jobId}`); return; }
      const projectId = params.get("project");
      if (projectId) {
        try {
          const res = await base44.functions.invoke("field-library", { action: "project", project_id: projectId });
          const linked = res?.data?.project?.job_id;
          if (!canceled) setTo(linked ? `/jobs/${linked}` : "/jobs");
        } catch {
          if (!canceled) setTo("/jobs");
        }
        return;
      }
      setTo("/jobs");
    })();
    return () => { canceled = true; };
  }, [params]);

  if (!to) return <div className="p-8 text-sm" style={{ color: "#53615B" }}>Opening Jobs…</div>;
  return <Navigate to={to} replace />;
}
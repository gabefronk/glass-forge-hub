import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { safeError } from "@/lib/jobCalendarShared";

// Owner-gated read of upcoming crew-calendar visits for one job. Bounded wait so
// the UI never spins forever; on error retains a visible error and never invents
// or clears records. `enabled` gates the call (non-owners never trigger a read).
// refreshKey lets the parent force a reload after a create succeeds.
export function useJobUpcoming(jobId, refreshKey = 0, { enabled = true } = {}) {
  const [state, setState] = useState({ loading: false, error: "", events: [] });
  useEffect(() => {
    if (!enabled || !jobId) { setState({ loading: false, error: "", events: [] }); return; }
    let live = true;
    setState({ loading: true, error: "", events: [] });
    (async () => {
      try {
        const invoke = base44.functions.invoke("jobCalendar", { action: "read_upcoming", job_id: jobId });
        const timeout = new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 20000));
        const res = await Promise.race([invoke, timeout]);
        if (!live) return;
        if (res && res.__timeout) { setState({ loading: false, error: safeError("job_calendar_failed") + " The crew calendar took too long to respond. Retry by reopening this job.", events: [] }); return; }
        const d = res?.data || {};
        if (d.error) setState({ loading: false, error: safeError(d.error), events: [] });
        else setState({ loading: false, error: "", events: d.events || [] });
      } catch {
        if (!live) return;
        setState({ loading: false, error: safeError("job_calendar_failed"), events: [] });
      }
    })();
    return () => { live = false; };
  }, [jobId, refreshKey, enabled]);
  return state;
}
import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeErrorOf } from "@/lib/jobContacts";

const call = async (body) => {
  try {
    const r = await base44.functions.invoke("contacts-directory", body);
    if (r?.data?.error) throw new Error(r.data.error);
    return r.data;
  } catch (error) {
    throw new Error(invokeErrorOf(error).message || error.message || "Contacts are unavailable.");
  }
};

// The job's saved super, readable and editable by anyone signed in. Saving
// reuses a directory contact with the same phone or email and links it to the
// job as superintendent (one per job). Nothing is written until save() runs.
export function useJobSuper(jobId) {
  const [state, setState] = useState({ loading: true, saved: null, error: "" });
  const version = useRef(0);
  const load = useCallback(async () => {
    const n = ++version.current;
    if (!jobId) { setState({ loading: false, saved: null, error: "" }); return; }
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await call({ action: "job_super", job_id: jobId });
      if (n === version.current) setState({ loading: false, saved: data?.super || null, error: "" });
    } catch (e) {
      if (n === version.current) setState({ loading: false, saved: null, error: e.message });
    }
  }, [jobId]);
  useEffect(() => { load(); return () => { version.current++; }; }, [load]);
  const save = useCallback(async ({ name, phone, email }) => {
    const data = await call({ action: "set_job_super", job_id: jobId, contact: { name, phone, email } });
    setState({ loading: false, saved: data?.super || null, error: "" });
    return data?.super;
  }, [jobId]);
  return { ...state, reload: load, save };
}

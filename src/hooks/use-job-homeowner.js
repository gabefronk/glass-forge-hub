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

// The job's homeowner, readable and editable by the same people as the super (anyone signed
// in). Saving links a chosen contact, or reuses / creates one by phone or email, as the job's
// homeowner (one per job). `prefill` is the job's customer name when nobody is saved yet.
export function useJobHomeowner(jobId) {
  const [state, setState] = useState({ loading: true, saved: null, prefill: null, error: "" });
  const version = useRef(0);
  const load = useCallback(async () => {
    const n = ++version.current;
    if (!jobId) { setState({ loading: false, saved: null, prefill: null, error: "" }); return; }
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await call({ action: "job_homeowner", job_id: jobId });
      if (n === version.current) setState({ loading: false, saved: data?.homeowner || null, prefill: data?.prefill || null, error: "" });
    } catch (e) {
      if (n === version.current) setState({ loading: false, saved: null, prefill: null, error: e.message });
    }
  }, [jobId]);
  useEffect(() => { load(); return () => { version.current++; }; }, [load]);
  // { contactKey } links an existing contact; { name, phone, email } finds or creates one.
  const save = useCallback(async ({ contactKey, name, phone, email }) => {
    const body = contactKey ? { contact_key: contactKey } : { contact: { name, phone, email } };
    const data = await call({ action: "set_job_homeowner", job_id: jobId, ...body });
    setState((s) => ({ ...s, loading: false, saved: data?.homeowner || null, error: "" }));
    return data?.homeowner;
  }, [jobId]);
  const remove = useCallback(async () => {
    await call({ action: "set_job_homeowner", job_id: jobId, remove: true });
    await load();
  }, [jobId, load]);
  return { ...state, reload: load, save, remove };
}

// Name search over the contacts the job-page pickers may show (name, company, phone, email).
let pickerCache = null;
export async function searchContacts(query) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  if (!pickerCache) pickerCache = call({ action: "picker" }).then((d) => d?.contacts || []).catch((e) => { pickerCache = null; throw e; });
  const list = await pickerCache;
  const digits = q.replace(/\D/g, "");
  return list.filter((c) => [c.name, c.company, c.email].some((v) => String(v || "").toLowerCase().includes(q)) || (digits.length >= 4 && String(c.phone || "").replace(/\D/g, "").includes(digits))).slice(0, 6);
}
export function clearContactSearch() { pickerCache = null; }

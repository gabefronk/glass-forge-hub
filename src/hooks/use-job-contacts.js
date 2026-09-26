import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeErrorOf, viewFromLegacy } from "@/lib/jobContacts";

const call = async (body) => {
  const r = await base44.functions.invoke("contacts-directory", body);
  if (r?.data?.error) throw Object.assign(new Error(r.data.error), { response: { status: 200, data: r.data } });
  return r.data;
};

async function fetchJobContacts(jobId) {
  try {
    return await call({ action: "job_contacts", job_id: jobId });
  } catch (error) {
    // Until the updated function is published, fall back to the linked contacts of the older action.
    const { status, message } = invokeErrorOf(error);
    if (status !== 400 || !/unsupported action/i.test(message)) throw error;
    const legacy = await call({ action: "job", job_id: jobId }).catch((e) => {
      if (invokeErrorOf(e).status === 404) return { contacts: [] };
      throw e;
    });
    return viewFromLegacy(legacy, jobId);
  }
}

// Read-only job contacts for the owner. `phase` is "private" for anyone else (403), which hides
// the section. Links are written only by confirmLink, i.e. by an explicit owner click.
export function useJobContacts(jobId) {
  const [state, setState] = useState({ phase: "loading", view: null, error: "" });
  const version = useRef(0);

  const load = useCallback(async () => {
    const n = ++version.current;
    if (!jobId) { setState({ phase: "idle", view: null, error: "" }); return; }
    setState((s) => (s.view?.job?.id === jobId ? { ...s, phase: "refreshing", error: "" } : { phase: "loading", view: null, error: "" }));
    try {
      const view = await fetchJobContacts(jobId);
      if (n === version.current) setState({ phase: "ready", view, error: "" });
    } catch (error) {
      if (n !== version.current) return;
      const { status, message } = invokeErrorOf(error);
      setState({ phase: status === 403 ? "private" : "error", view: null, error: message || "Contacts could not be loaded." });
    }
  }, [jobId]);

  useEffect(() => {
    load();
    return () => { version.current++; };
  }, [load]);

  const confirmLink = useCallback(async ({ contactKey, role }) => {
    await confirmContactLink({ jobId, contactKey, role });
    await load();
  }, [jobId, load]);

  // A person named in the job's notes (e.g. a calendar "SPR:" line) who is not a contact yet:
  // creates the contact (or reuses one with that phone / email) and links it in that role.
  const addContact = useCallback(async ({ role, contact }) => {
    await addJobRoleContact({ jobId, role, contact });
    await load();
  }, [jobId, load]);

  return { ...state, reload: load, confirmLink, addContact };
}

export function addJobRoleContact({ jobId, role, contact }) {
  const action = role === "homeowner" ? "set_job_homeowner" : "set_job_super";
  return call({ action, job_id: jobId, contact: { name: contact.name, phone: contact.phone || "", email: contact.email || "" } });
}

// The single write path: the existing owner-only `link` action, marked as a confirmed suggestion.
export function confirmContactLink({ jobId, contactKey, role }) {
  return call({ action: "link", contact_key: contactKey, job_id: jobId, source: "suggestion", ...(role ? { role } : {}) });
}

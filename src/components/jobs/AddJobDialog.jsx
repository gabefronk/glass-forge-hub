import { useEffect, useMemo, useState } from "react";
import { Link2, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { confirmContactLink } from "@/hooks/use-job-contacts";
import { findDuplicateJobs, newJobPayload } from "@/lib/newJob";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const blank = { canonical_name: "", builder: "", address: "", po_number: "", oe_number: "" };
const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none sm:text-sm";

export default function AddJobDialog({ jobs, onCreated }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(blank);
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [contactsError, setContactsError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [duplicateApproved, setDuplicateApproved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    base44.functions.invoke("contacts-directory", { action: "picker" })
      .then((r) => { if (active) setContacts(r.data?.contacts || []); })
      .catch(() => { if (active) setContactsError("Contacts could not load. You can still create the job."); });
    return () => { active = false; };
  }, [open]);

  const reset = () => {
    setValues(blank); setContactSearch(""); setSelected([]); setError("");
    setDuplicates([]); setDuplicateApproved(false); setContactsError(""); setContacts([]);
  };
  const change = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setDuplicates([]); setDuplicateApproved(false); setError("");
  };
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts.slice(0, 8);
    return contacts.filter((contact) => [contact.name, contact.company, contact.email, contact.phone]
      .some((value) => String(value || "").toLowerCase().includes(q))).slice(0, 20);
  }, [contacts, contactSearch]);

  const submit = async (event) => {
    event.preventDefault();
    const payload = newJobPayload(values);
    if (!payload.canonical_name) { setError("Job name is required."); return; }
    const matches = findDuplicateJobs(jobs, values);
    if (matches.length && !duplicateApproved) { setDuplicates(matches); return; }
    setSaving(true); setError("");
    try {
      const created = await base44.entities.Jobs.create(payload);
      const linkResults = await Promise.allSettled(selected.map((contactKey) => confirmContactLink({ jobId: created.id, contactKey })));
      const failedLinks = linkResults.filter((result) => result.status === "rejected").length;
      onCreated(created);
      setOpen(false);
      reset();
      if (failedLinks) window.setTimeout(() => window.alert(`Job created, but ${failedLinks} contact link${failedLinks === 1 ? "" : "s"} could not be saved.`), 0);
    } catch (cause) {
      setError(cause?.response?.data?.error || cause?.message || "The job could not be created. Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--gf-brass-400)] px-3.5 text-sm font-semibold text-[var(--gf-on-brass)]">
          <Plus className="h-4 w-4" /> Add job
        </button>
      </DialogTrigger>
      <DialogContent className="bottom-0 top-auto w-full max-w-none translate-y-0 rounded-b-none rounded-t-2xl sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Add job</DialogTitle>
          <DialogDescription>Add the field details you know now. You can fill in the rest later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">Job name <span className="text-red-700">*</span><input autoFocus required className={inputClass} value={values.canonical_name} onChange={(e) => change("canonical_name", e.target.value)} /></label>
          <label className="block text-sm font-medium">Builder <span className="font-normal text-slate-500">(optional)</span><input className={inputClass} value={values.builder} onChange={(e) => change("builder", e.target.value)} /></label>
          <label className="block text-sm font-medium">Site address <span className="font-normal text-slate-500">(recommended)</span><input className={inputClass} autoComplete="street-address" value={values.address} onChange={(e) => change("address", e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">PO number <span className="font-normal text-slate-500">(optional)</span><input className={inputClass} value={values.po_number} onChange={(e) => change("po_number", e.target.value)} /></label>
            <label className="block text-sm font-medium">OE number <span className="font-normal text-slate-500">(optional)</span><input className={inputClass} value={values.oe_number} onChange={(e) => change("oe_number", e.target.value)} /></label>
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="new-job-contact-search">Contacts <span className="font-normal text-slate-500">(optional)</span></label>
            <div className="relative mt-1.5"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input id="new-job-contact-search" className={`${inputClass} mt-0 pl-9`} placeholder="Search people" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} /></div>
            {contactsError && <p className="mt-2 text-xs text-amber-700">{contactsError}</p>}
            {(contactSearch || selected.length > 0) && filteredContacts.length > 0 && <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border p-1.5">
              {filteredContacts.map((contact) => {
                const checked = selected.includes(contact.key);
                return <label key={contact.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-slate-50"><input type="checkbox" checked={checked} onChange={() => setSelected((current) => checked ? current.filter((key) => key !== contact.key) : [...current, contact.key])} /><span className="min-w-0"><strong className="block truncate text-sm">{contact.name}</strong><span className="block truncate text-xs text-slate-500">{contact.company || contact.email || contact.phone}</span></span></label>;
              })}
            </div>}
            {selected.length > 0 && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-800"><Link2 className="h-3.5 w-3.5" />{selected.length} contact{selected.length === 1 ? "" : "s"} selected</p>}
          </div>
          {duplicates.length > 0 && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <strong>Looks like this job already exists</strong>
            <ul className="mt-1 space-y-1">{duplicates.map((job) => <li key={job.id}><Link className="underline" to={`/jobs/${job.id}`} target="_blank">{job.canonical_name || "Open matching job"}</Link></li>)}</ul>
            <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-2"><input type="checkbox" checked={duplicateApproved} onChange={(e) => setDuplicateApproved(e.target.checked)} /> Create anyway</label>
          </div>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <DialogFooter>
            <button type="button" disabled={saving} onClick={() => setOpen(false)} className="min-h-11 rounded-xl border px-4 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={saving || (duplicates.length > 0 && !duplicateApproved)} className="min-h-11 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating…" : duplicateApproved ? "Create anyway" : "Create job"}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

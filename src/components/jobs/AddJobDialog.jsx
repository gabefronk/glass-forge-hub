import { useEffect, useMemo, useState } from "react";
import { Link2, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { confirmContactLink } from "@/hooks/use-job-contacts";
import { findDuplicateJobs, newJobPayload } from "@/lib/newJob";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const blank = { canonical_name: "", builder: "", address: "", po_number: "", oe_number: "", source_window_quote_id: "", initial_note: "" };
const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none sm:text-sm";

export default function AddJobDialog({ jobs, onCreated }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(blank);
  const [contacts, setContacts] = useState([]);
  const [createdState, setCreatedState] = useState(null);
  const [owner, setOwner] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [newContact, setNewContact] = useState({name:"",email:"",phone:"",company:"",builder:""});
  const [contactsError, setContactsError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [duplicateApproved, setDuplicateApproved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    base44.auth.me().then(u=>{if(active)setOwner(isAgentCenterOwner(u));}).catch(()=>{});
    base44.functions.invoke("contacts-directory", { action: "picker" })
      .then((r) => { if (active) setContacts(r.data?.contacts || []); })
      .catch(() => { if (active) setContactsError("Contacts could not load. You can still create the job."); });
    return () => { active = false; };
  }, [open]);

  const reset = () => {
    setValues(blank); setContactSearch(""); setSelected([]); setError("");
    setDuplicates([]); setDuplicateApproved(false); setContactsError(""); setContacts([]); setCreatedState(null); setNewContact({name:"",email:"",phone:"",company:"",builder:""});
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
    if (createdState?.jobId) { setError("This job was already created. Open it instead of submitting twice."); return; }
    const matches = findDuplicateJobs(jobs, values);
    if (matches.length && !duplicateApproved) { setDuplicates(matches); return; }
    if (newContact.name.trim() && !owner) { setError("Only the owner can add a contact here. Ask them to create it in Contacts."); return; }
    if (values.source_window_quote_id.trim() && !owner) { setError("Only the owner can link a source quote. Leave this blank."); return; }
    if (values.source_window_quote_id.trim()) {
      try { const q=await base44.entities.QuoteRequests.get(values.source_window_quote_id.trim()); if (!q) throw Error("Quote not found"); }
      catch { setError("Source quote ID was not found. Leave it blank or choose a verified quote."); return; }
    }
    setSaving(true); setError("");
    try {
      // Create the job first. If it succeeds, never invite a duplicate job write
      // merely because one of its independent setup steps fails.
      const created = await base44.entities.Jobs.create(payload);
      const result = { jobId: created.id, contactLinks: [], folder: "pending", note: "skipped", contact: "skipped" };
      setCreatedState(result);
      let newContactKey = "";
      if (newContact.name.trim()) {
        try {
          const r = (await base44.functions.invoke("contacts-directory", { action: "create_contact", contact: newContact })).data;
          if (r?.error) throw Error(r.error);
          newContactKey = r.contact.key;
          result.contact = "saved";
        } catch { result.contact = "failed"; }
      }
      const selectedKeys = [...new Set([...selected,...(newContactKey?[newContactKey]:[])])];
      const linkResults = await Promise.allSettled(selectedKeys.map((contactKey) => confirmContactLink({ jobId: created.id, contactKey })));
      result.contactLinks = linkResults.map((r,i) => ({ key: selectedKeys[i], status: r.status }));
      try {
        if (!owner) throw Error("Owner must link Drive folder");
        const folder = (await base44.functions.invoke("job-documents", { action: "ensure_folder", job_id: created.id })).data;
        if (folder?.error) throw Error(folder.error);
        result.folder = folder.folder?.url || "unavailable";
      } catch { result.folder = owner ? "failed" : "owner-only"; }
      if (values.initial_note.trim()) {
        try {
          const author = (await base44.auth.me()).email || "Hub user";
          if (!owner) throw Error("Owner must save initial note");
          await base44.entities.JobNotes.create({ job_id: created.id, note_date: new Date().toISOString().slice(0,10), body: values.initial_note.trim(), author });
          result.note = "saved";
        } catch { result.note = "failed"; }
      }
      setCreatedState({...result});
      onCreated(created);
      const failures = result.contactLinks.filter(x=>x.status==='rejected').length;
      if (!failures && result.contact !== "failed" && result.folder !== "failed" && result.folder !== "unavailable" && result.note !== "failed") { setOpen(false); reset(); }
      else setError(`Job created. ${result.contact === "failed" ? "New contact was not saved. " : ""}${failures ? `${failures} contact link(s) failed. ` : ""}${result.folder === "failed" || result.folder === "unavailable" ? "Drive folder was not linked. " : ""}${result.note === "failed" ? "Initial note was not saved. " : ""}Open the job and finish those steps; do not create it again.`);
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
          {owner && <label className="block text-sm font-medium">Source Window Quote ID <span className="font-normal text-slate-500">(only if known)</span><input className={inputClass} value={values.source_window_quote_id} onChange={(e) => change("source_window_quote_id", e.target.value)} /></label>}
          {owner && <label className="block text-sm font-medium">Initial activity note <span className="font-normal text-slate-500">(optional, visible to the job team)</span><textarea className={inputClass} value={values.initial_note} onChange={(e) => change("initial_note", e.target.value)} /></label>}
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
            {owner && <details className="mt-2 rounded-xl border p-3"><summary className="cursor-pointer text-sm">Add new contact for this job (owner only)</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{[["name","Name"],["email","Email"],["phone","Phone"],["company","Company"],["builder","Builder"]].map(([key,label])=><label key={key} className="text-xs">{label}<input className={inputClass} type={key==='email'?'email':'text'} value={newContact[key]} onChange={e=>setNewContact(v=>({...v,[key]:e.target.value}))}/></label>)}</div><p className="mt-2 text-xs">An existing email or phone must be selected from the picker instead of creating a duplicate.</p></details>}
          {selected.length > 0 && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-800"><Link2 className="h-3.5 w-3.5" />{selected.length} contact{selected.length === 1 ? "" : "s"} selected</p>}
          </div>
          {duplicates.length > 0 && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <strong>Looks like this job already exists</strong>
            <ul className="mt-1 space-y-1">{duplicates.map((job) => <li key={job.id}><Link className="underline" to={`/jobs/${job.id}`} target="_blank">{job.canonical_name || "Open matching job"}</Link></li>)}</ul>
            <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-2"><input type="checkbox" checked={duplicateApproved} onChange={(e) => setDuplicateApproved(e.target.checked)} /> Create anyway</label>
          </div>}
          {createdState?.jobId && <p className="text-sm text-blue-800">Job created: <Link className="underline" to={`/jobs/${createdState.jobId}`}>Open job</Link>. New contact: {createdState.contact}. Contact links: {createdState.contactLinks.filter(x=>x.status==='fulfilled').length}/{createdState.contactLinks.length}. Folder: {createdState.folder.startsWith?.('https:') ? <a className="underline" href={createdState.folder} target="_blank" rel="noreferrer">Open Drive</a> : createdState.folder}. Note: {createdState.note}.</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <DialogFooter>
            <button type="button" disabled={saving} onClick={() => setOpen(false)} className="min-h-11 rounded-xl border px-4 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={saving || !!createdState?.jobId || (duplicates.length > 0 && !duplicateApproved)} className="min-h-11 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating…" : duplicateApproved ? "Create anyway" : "Create job"}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

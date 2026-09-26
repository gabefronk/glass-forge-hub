import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRightCircle, Check, CheckCircle2, ExternalLink, FileUp, Pencil, Send, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { C } from "@/lib/feeUI";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import { fmtDate } from "../../../base44/shared/jobHandoff.js";

// Stage 2 handoff card (owner + managers; crews never see it). Before submit: the gated
// checklist, ETA, start date, who it goes to, a note, Save draft / Submit. After submit: the
// Stage 2 banner with the packet that went out, and Edit for ETA / start date / note.
const canUse = (user) => user?.role === "admin" || user?.role === "manager";
const call = async (body) => {
  const r = await base44.functions.invoke("jobHandoff", body);
  const data = r?.data;
  if (data && typeof data === "object" && data.error) { const e = new Error(data.error); e.missing = data.missing; e.view = data; throw e; }
  return data || {};
};
const btn = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50";
const btnNeutral = { backgroundColor: "#FFFFFF", color: "var(--gf-ink)", border: "1px solid var(--gf-border)" };
const btnPrimary = { backgroundColor: "var(--gf-teal-600)", color: "#f2eee8", border: "1px solid var(--gf-teal-700)" };
const btnBrass = { backgroundColor: "var(--gf-brass-400)", color: "var(--gf-on-brass)", border: "1px solid transparent" };
const field = { border: `1px solid ${C.border}`, color: C.text };
const input = "min-h-11 w-full rounded-[9px] bg-white px-3 text-[13.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]";
const lbl = "flex flex-col gap-1 text-[12px] font-semibold";

function draftFrom(view) {
  const h = view?.handoff || {};
  return { checklist: (view?.items || []).map((i) => ({ key: i.key, done: i.done, value: i.value || "", file_url: i.file_url || "", file_name: i.file_name || "" })), eta_date: h.eta_date || "", start_date: h.start_date || "", notes: h.notes || "", po_number: h.po_number || "", folder_link: h.folder_link || "", to_member_key: h.to_member_key || "" };
}

export default function JobHandoffCard({ jobId }) {
  const { user } = useAuth();
  const allowed = canUse(user);
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const fileInputs = useRef({});
  const seq = useRef(0);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    if (!allowed || !jobId) return;
    const mine = ++seq.current;
    try {
      const v = await call({ action: "get", job_id: jobId });
      if (mine !== seq.current) return;
      setView(v);
      if (!dirty.current) setDraft(draftFrom(v));
      setError("");
    } catch (e) { if (mine === seq.current) setError(e.message || "The handoff could not load."); }
  }, [jobId, allowed]);
  useEffect(() => { dirty.current = false; load(); return () => { seq.current++; }; }, [load]);

  if (!allowed) return null;
  const h = view?.handoff;
  const submitted = h && h.status !== "draft";
  const items = view?.items || [];

  const setItem = (key, patch) => { dirty.current = true; setDraft((d) => ({ ...d, checklist: d.checklist.map((c) => (c.key === key ? { ...c, ...patch } : c)) })); };
  const setField = (k, v) => { dirty.current = true; setDraft((d) => ({ ...d, [k]: v })); };

  const persist = async (action) => {
    if (!draft) return null;
    setBusy(action); setError(""); setNotice("");
    try {
      const v = await call({ action, job_id: jobId, ...draft });
      dirty.current = false;
      setView(v); setDraft(draftFrom(v));
      return v;
    } catch (e) {
      if (e.view?.items) { setView(e.view); }
      setError(e.missing?.length ? `Not ready yet — still missing: ${e.missing.join(", ")}.` : (e.message || "Could not save."));
      return null;
    } finally { setBusy(""); }
  };

  const saveDraft = async () => { const v = await persist("save_draft"); if (v) setNotice("Draft saved."); };
  const submit = async () => {
    const v = await persist("submit");
    if (!v) return;
    setEditing(false);
    setNotice(`Handed off to ${v.handoff?.to_name || "the PM"}. ${(v.changes || []).join(" · ")}`);
    window.dispatchEvent(new CustomEvent("gf:job-stage", { detail: { jobId, stage: v.job?.stage || "handed_off", pm: v.job?.pm_member_key || "" } }));
  };
  const update = async () => {
    const v = await persist("update");
    if (!v) return;
    setEditing(false);
    setNotice("Updated — the to-do, kickoff and packet follow the new dates.");
  };

  const upload = async (key, files) => {
    const file = [...(files || [])][0];
    if (!file) return;
    setUploadingKey(key); setError("");
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setItem(key, { file_url, file_name: file.name });
    } catch (e) { setError(e.message || "Upload failed."); }
    finally { setUploadingKey(""); }
  };

  const members = view?.members || [];
  const ready = !!view?.ready && !!draft?.start_date;

  // ---- After submit: the Stage 2 banner --------------------------------------------------------
  if (submitted && !editing) {
    return (
      <SheetCard icon={ArrowRightCircle} tile={TILE.bronze} title="Stage 2 · Handed off" sub={`${h.to_name || "PM"} · starts ${fmtDate(h.start_date) || "—"}`}
        right={<button type="button" className={btn} style={btnNeutral} onClick={() => { setDraft(draftFrom(view)); setEditing(true); setNotice(""); }}><Pencil className="h-3.5 w-3.5" />Edit</button>}>
        {notice ? <p role="status" className="m-0 mb-3 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "var(--gf-teal-050)", color: C.accentText }}>{notice}</p> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]" style={{ color: C.textSecondary }}>
          <span><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" style={{ color: "var(--gf-teal-600)" }} />In {h.to_name || "the PM"}'s hands</span>
          <span>Submitted by {h.from_name || "—"}{h.submitted_at ? ` · ${new Date(h.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
          {h.eta_date ? <span>ETA {fmtDate(h.eta_date)}</span> : null}
          <Link to="/todos" className="hover:underline" style={{ color: C.accentText }}>On {h.to_name ? `${h.to_name.split(" ")[0]}'s` : "the"} board</Link>
        </div>
        <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[10px] p-3 text-[12.5px] leading-[18px]" style={{ backgroundColor: C.cardAlt, color: C.text, border: `1px solid ${C.rowBorder}`, fontFamily: "inherit" }}>{h.summary}</pre>
        {h.history?.length ? <p className="m-0 mt-2 text-[11.5px]" style={{ color: C.textMuted }}>{h.history.slice(-3).map((x) => `${new Date(x.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${x.what} (${x.by})`).join(" · ")}</p> : null}
      </SheetCard>
    );
  }

  // ---- Before submit (or editing after): the checklist ---------------------------------------------
  return (
    <SheetCard icon={ArrowRightCircle} tile={TILE.bronze} title={submitted ? "Stage 2 · Edit handoff" : "Hand off"} sub={submitted ? "" : "sold, ordered, documented → to the PM"}
      right={submitted ? <button type="button" className={btn} style={btnNeutral} onClick={() => { setEditing(false); dirty.current = false; setDraft(draftFrom(view)); }}><X className="h-3.5 w-3.5" />Cancel</button> : null}>
      {error ? <p role="alert" className="m-0 mb-3 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)", border: "1px solid var(--gf-error-border)" }}>{error}</p> : null}
      {notice ? <p role="status" className="m-0 mb-3 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "var(--gf-teal-050)", color: C.accentText }}>{notice}</p> : null}
      {!view || !draft ? <p className="m-0 text-[13px]" style={{ color: C.textSecondary }}>Loading…</p> : (
        <div className="flex flex-col gap-3">
          <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Handoff checklist">
            {items.map((it) => {
              const d = draft.checklist.find((c) => c.key === it.key) || {};
              const ok = it.ok;
              return (
                <li key={it.key} className="rounded-[10px] px-3 py-2.5" style={{ border: `1px solid ${ok ? C.tagBillable.border : it.required ? "var(--gf-amber-500)" : C.rowBorder}`, backgroundColor: ok ? "var(--gf-teal-050)" : "#fff" }}>
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: ok ? "var(--gf-teal-600)" : "#fff", border: `1px solid ${ok ? "var(--gf-teal-600)" : C.border}`, color: "#fff" }}>{ok ? <Check className="h-3 w-3" /> : null}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold" style={{ color: C.text }}>{it.label}</div>
                      <div className="text-[12px]" style={{ color: ok ? C.accentText : C.textMuted }}>{it.detail}</div>
                      {it.warning ? <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--gf-amber-700, #8a6420)" }}><AlertTriangle className="mr-1 inline h-3 w-3" />{it.warning}</div> : null}
                      {it.kind === "po" && !(view.job?.po_numbers || []).length ? <input value={draft.po_number} onChange={(e) => setField("po_number", e.target.value)} placeholder="Type the PO number" className={`${input} mt-2 max-w-[260px]`} style={field} /> : null}
                      {it.kind === "date" ? <input type="date" value={draft.eta_date} onChange={(e) => setField("eta_date", e.target.value)} className={`${input} mt-2 max-w-[220px]`} style={field} aria-label="Vendor ETA" /> : null}
                      {it.kind === "upload_or_folder" && !view.job?.folder_url ? <input value={draft.folder_link} onChange={(e) => setField("folder_link", e.target.value)} placeholder="…or paste the OneDrive / Drive folder link" className={`${input} mt-2 max-w-[420px]`} style={field} /> : null}
                      {it.kind === "scope" ? <label className="mt-2 inline-flex items-center gap-2 text-[12.5px]" style={{ color: C.text }}><input type="checkbox" checked={!!d.done} onChange={(e) => setItem(it.key, { done: e.target.checked })} className="h-4 w-4" />The Scope card says what this job is</label> : null}
                    </div>
                    {(it.kind === "upload_or_folder" || it.kind === "upload_or_budget") ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {d.file_url ? <a href={d.file_url} target="_blank" rel="noopener noreferrer" className={btn} style={btnNeutral}><ExternalLink className="h-3.5 w-3.5" />{(d.file_name || "file").slice(0, 22)}</a> : null}
                        <button type="button" className={btn} style={btnNeutral} disabled={uploadingKey === it.key} onClick={() => fileInputs.current[it.key]?.click()}><FileUp className="h-3.5 w-3.5" />{uploadingKey === it.key ? "Uploading…" : d.file_url ? "Replace" : "Attach"}</button>
                        <input ref={(el) => { fileInputs.current[it.key] = el; }} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { upload(it.key, e.target.files); e.target.value = ""; }} />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={lbl} style={{ color: C.textSecondary }}>Start date — when {draft.to_member_key ? (members.find((m) => m.member_key === draft.to_member_key)?.display_name?.split(" ")[0] || "the PM") : "the PM"} jumps on it
              <input type="date" value={draft.start_date} onChange={(e) => setField("start_date", e.target.value)} className={input} style={field} />
            </label>
            <label className={lbl} style={{ color: C.textSecondary }}>Hand off to
              <select value={draft.to_member_key} onChange={(e) => setField("to_member_key", e.target.value)} className={input} style={field}>
                <option value="">Choose…</option>
                {members.map((m) => <option key={m.member_key} value={m.member_key}>{m.display_name}</option>)}
              </select>
            </label>
          </div>
          <label className={lbl} style={{ color: C.textSecondary }}>Note to {draft.to_member_key ? (members.find((m) => m.member_key === draft.to_member_key)?.display_name?.split(" ")[0] || "the PM") : "the PM"}
            <textarea value={draft.notes} onChange={(e) => setField("notes", e.target.value)} rows={3} maxLength={2000} placeholder="What they should know before the first call" className="w-full rounded-[9px] bg-white px-3 py-2 text-[13.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={field} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {submitted ? (
              <button type="button" className={btn} style={btnPrimary} disabled={!!busy} onClick={update}>{busy === "update" ? "Updating…" : "Save changes"}</button>
            ) : (
              <>
                <button type="button" className={btn} style={btnNeutral} disabled={!!busy} onClick={saveDraft}>{busy === "save_draft" ? "Saving…" : "Save draft"}</button>
                <button type="button" className={btn} style={btnBrass} disabled={!!busy || !ready || !draft.to_member_key} onClick={submit} title={ready ? "" : "Every item above must pass, plus a start date"}><Send className="h-3.5 w-3.5" />{busy === "submit" ? "Submitting…" : `Submit to ${draft.to_member_key ? (members.find((m) => m.member_key === draft.to_member_key)?.display_name?.split(" ")[0] || "PM") : "PM"}`}</button>
                <span className="text-[12px]" style={{ color: C.textMuted }}>{view.ready ? (draft.start_date ? "Ready to go." : "Pick a start date.") : `${view.missing.length} item${view.missing.length === 1 ? "" : "s"} still open. Drafts save as you go.`}</span>
              </>
            )}
          </div>
        </div>
      )}
    </SheetCard>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Upload } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { base44 } from "@/api/base44Client";
import { money } from "@/components/budgets/ProcurementForms";
import { PageShell } from "@/components/PageShell";
import { openPrivateFile } from "@/components/jobs/FlashingGuideLink";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MAX_GUIDE_BYTES, builderKey, history, importDefaults, moveGuide, newGuide, pdfProblem, replaceFilePatch, sha256Hex, sizeLabel, sortGuides } from "@/lib/installGuides";

// Install guides (Gabe, Oct 31): the flashing / install method PDFs sent with YA quotes and
// pinned to jobs, kept in the Hub (InstallGuides, private files) instead of Drive. Replacing a
// file adds a version; jobs keep the version their customer approved. Rules live in
// src/lib/installGuides.js.

const BAND = "#0B3F3B", TITLE = "#F2EEE8", LABEL = "#C3CBCC";
const INK = "#101617", SECONDARY = "#566063", STRONG = "#34403F", RULE = "#D6CCBA", HEAD_BG = "#E9E2D4", LATE = "#A43432";
const th = "whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.04em]";
const td = "text-[14px] align-top";
const cell = { padding: "7px 12px", borderBottom: `1px solid ${RULE}` };
const BTN = "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[14px] font-semibold disabled:opacity-60";
const FIELD = "h-9 w-full rounded-[8px] border bg-white px-2.5 text-[14px]";
const ITEM = "cursor-pointer px-3 py-2 text-[14px]";
const dayLabel = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const invoke = (name, body) => base44.functions.invoke(name, body);
const dataOf = (r) => { const d = r?.data ?? r; if (d?.error) throw new Error(d.error); return d; };
const errorText = (e) => e?.response?.data?.error || e?.message || "Something went wrong.";

// A picked file -> checked bytes, or an Error saying why it can't be a guide.
async function checkedPdf(file) {
  if (file.size > MAX_GUIDE_BYTES) throw new Error(`${file.name} is over 25 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = pdfProblem(bytes, file.name);
  if (problem) throw new Error(problem);
  return { bytes, sha256: await sha256Hex(bytes) };
}

async function storePdf(name, bytes, sha256) {
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file: new File([bytes], name, { type: "application/pdf" }) });
  return { file_uri, file_name: name, size: bytes.length, sha256 };
}

// One-time import from Drive › INSTALL BUDGET SHEET › Install Type Guides through the old
// job-documents guide actions (they need some job to authorise the call; any job will do).
function fromBase64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; }
async function driveBytes(jobId, fileId) {
  const parts = []; let offset = 0;
  for (;;) {
    const r = dataOf(await invoke("job-documents", { action: "guide_chunk", job_id: jobId, file_id: fileId, offset }));
    const bytes = fromBase64(r.data); parts.push(bytes); offset += bytes.length;
    if (r.done || !bytes.length) break;
  }
  const out = new Uint8Array(offset); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function RowMenu({ items }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Guide actions" title="Guide actions" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-black/5" style={{ color: STRONG }}>
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] p-1">
        {items.filter(Boolean).map((it) => <DropdownMenuItem key={it.label} className={ITEM} onSelect={it.onSelect} style={it.danger ? { color: LATE } : undefined}>{it.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EditRow({ guide, builders, busy, onSave, onCancel }) {
  const [form, setForm] = useState({ name: guide.name || "", description: guide.description || "", builder_match: guide.builder_match || "", price: guide.price_per_opening ?? "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const options = builders.some((b) => builderKey(b) === builderKey(form.builder_match)) || !form.builder_match ? builders : [form.builder_match, ...builders];
  const save = (e) => {
    e.preventDefault();
    const price = String(form.price).trim() === "" ? null : Number(String(form.price).replace(/[$,]/g, ""));
    if (!form.name.trim()) return onSave(null, "Enter a name for the guide.");
    if (price !== null && !(price >= 0)) return onSave(null, "Price per opening must be a dollar amount.");
    onSave({ name: form.name.trim(), description: form.description.trim(), builder_match: form.builder_match, price_per_opening: price });
  };
  const label = "flex flex-col gap-1 text-[13px] font-semibold";
  return (
    <form onSubmit={save} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2.5 max-[699px]:grid-cols-1">
      <label className={label} style={{ color: STRONG }}>Name<input value={form.name} onChange={set("name")} className={FIELD} style={{ borderColor: RULE, color: INK }} /></label>
      <label className={label} style={{ color: STRONG }}>Builder default
        <select value={form.builder_match} onChange={set("builder_match")} className={FIELD} style={{ borderColor: RULE, color: INK }}>
          <option value="">None</option>
          {options.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className={label} style={{ color: STRONG }}>Price per opening<input value={form.price} onChange={set("price")} inputMode="decimal" placeholder="0.00" className={FIELD} style={{ borderColor: RULE, color: INK }} /></label>
      <label className={`${label} col-span-full`} style={{ color: STRONG }}>Description<input value={form.description} onChange={set("description")} placeholder="When to use this guide" className={FIELD} style={{ borderColor: RULE, color: INK }} /></label>
      <div className="col-span-full flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={BTN} style={{ backgroundColor: BAND, color: TITLE }}>Save</button>
        <button type="button" disabled={busy} onClick={onCancel} className={`${BTN} border`} style={{ borderColor: RULE, color: STRONG, background: "#FFFFFF" }}>Cancel</button>
        <span className="text-[13px]" style={{ color: SECONDARY }}>{sizeLabel(guide.size)} · v{guide.version || 1} · {guide.file_name}</span>
      </div>
    </form>
  );
}

function InstallGuidesContent() {
  const [state, setState] = useState({ loading: true, guides: [], jobs: [] });
  const [view, setView] = useState("active");
  const [editing, setEditing] = useState(""), [historyOf, setHistoryOf] = useState("");
  const [busy, setBusy] = useState(""), [message, setMessage] = useState(null); // { text, tone }
  const addRef = useRef(null), replaceRef = useRef(null), replaceTarget = useRef(null);

  const load = async () => {
    const [guides, jobs] = await Promise.all([base44.entities.InstallGuides.list("sort_order", 500), base44.entities.Jobs.list("-updated_date", 2000)]);
    setState({ loading: false, guides: guides || [], jobs: jobs || [] });
  };
  useEffect(() => { load().catch((e) => { setState((s) => ({ ...s, loading: false })); setMessage({ text: errorText(e), tone: "bad" }); }); }, []);

  const active = useMemo(() => sortGuides(state.guides), [state.guides]);
  const shown = useMemo(() => {
    const all = sortGuides(state.guides, { retired: true });
    return view === "active" ? active : view === "retired" ? all.filter((g) => g.active === false) : all;
  }, [state.guides, active, view]);
  const jobCount = useMemo(() => {
    const m = new Map();
    for (const j of state.jobs) if (j.flashing_guide_id) m.set(j.flashing_guide_id, (m.get(j.flashing_guide_id) || 0) + 1);
    return m;
  }, [state.jobs]);
  // One spelling per builder from the jobs ("Holmes Homes", not also "HOLMES HOMES" and "Holmes").
  const builders = useMemo(() => {
    const seen = new Map();
    for (const j of state.jobs) { const b = String(j.builder || "").trim(), k = builderKey(b); if (k && !j.is_sample && !j.merged_into && !seen.has(k)) seen.set(k, b); }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [state.jobs]);

  async function run(label, fn) {
    if (busy) return;
    setBusy(label); setMessage(null);
    try { const text = await fn(); if (text) setMessage({ text, tone: "ok" }); await load(); }
    catch (e) { setMessage({ text: errorText(e), tone: "bad" }); }
    finally { setBusy(""); }
  }

  const addFile = (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    run("Uploading…", async () => {
      const { bytes, sha256 } = await checkedPdf(file);
      const stored = await storePdf(file.name, bytes, sha256);
      const last = Math.max(0, ...state.guides.map((g) => g.sort_order || 0));
      const created = await base44.entities.InstallGuides.create(newGuide({ file: stored, sort_order: last + 1 }));
      setEditing(created.id);
      return `Added ${created.name}. Check its name, builder and price below.`;
    });
  };

  const replaceFile = (e) => {
    const file = e.target.files?.[0], guide = replaceTarget.current; e.target.value = "";
    if (!file || !guide) return;
    run("Uploading…", async () => {
      const { bytes, sha256 } = await checkedPdf(file);
      replaceFilePatch(guide, { sha256 }); // refuses the same file before uploading it
      const patch = replaceFilePatch(guide, await storePdf(file.name, bytes, sha256));
      await base44.entities.InstallGuides.update(guide.id, patch);
      return `${guide.name} is now version ${patch.version}. Jobs already sent version ${guide.version || 1} keep it.`;
    });
  };

  const importDrive = () => run("Importing from Drive…", async () => {
    const [job] = await base44.entities.Jobs.list("-updated_date", 1);
    const files = dataOf(await invoke("job-documents", { action: "install_guides", job_id: job.id })).guides || [];
    const done = new Set(state.guides.map((g) => g.source_drive_file_id).filter(Boolean));
    const imported = [], skipped = [];
    let order = Math.max(0, ...state.guides.map((g) => g.sort_order || 0));
    for (const f of files) {
      if (done.has(f.id)) continue;
      const { name, builder_match } = importDefaults(f.name);
      setBusy(`Importing ${name}…`);
      const bytes = await driveBytes(job.id, f.id);
      const problem = pdfProblem(bytes, `"${name}"`);
      if (problem) { skipped.push(problem); continue; }
      const sha256 = await sha256Hex(bytes);
      order += 1;
      await base44.entities.InstallGuides.create(newGuide({ name, builder_match, sort_order: order, file: await storePdf(f.name, bytes, sha256), source_drive_file_id: f.id }));
      imported.push(name);
    }
    return `Imported ${imported.length} guide${imported.length === 1 ? "" : "s"} from Drive.${skipped.length ? ` Skipped ${skipped.length}: ${skipped.join(" ")}` : ""}`;
  });

  const move = (id, dir) => run("Saving…", async () => {
    for (const p of moveGuide(state.guides, id, dir)) await base44.entities.InstallGuides.update(p.id, { sort_order: p.sort_order });
  });
  const setActive = (g, on) => run("Saving…", async () => {
    await base44.entities.InstallGuides.update(g.id, on ? { active: true, sort_order: Math.max(0, ...active.map((a) => a.sort_order || 0)) + 1 } : { active: false });
    return on ? `${g.name} is offered again.` : `${g.name} is retired. Jobs that already have it still open their version.`;
  });
  const saveEdit = (g) => (patch, problem) => {
    if (problem) { setMessage({ text: problem, tone: "bad" }); return; }
    run("Saving…", async () => { await base44.entities.InstallGuides.update(g.id, patch); setEditing(""); });
  };
  const openFile = (uri) => openPrivateFile(uri).catch((e) => setMessage({ text: `Couldn't open the PDF: ${errorText(e)}`, tone: "bad" }));

  if (state.loading) {
    return <PageShell><div className="flex items-center justify-center py-24"><div className="h-7 w-7 animate-spin rounded-full border-2" style={{ borderColor: RULE, borderTopColor: BAND }} /></div></PageShell>;
  }
  const retiredCount = state.guides.length - active.length;

  return (
    <PageShell>
      <section className="rounded-[12px]" style={{ backgroundColor: BAND }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" style={{ minHeight: "68px", padding: "10px 12px 10px 20px" }}>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[24px] font-bold" style={{ color: TITLE, letterSpacing: "-0.03em" }}>Install guides</h1>
            <div className="text-[13px] font-medium" style={{ color: LABEL }}>Sent with YA quotes and pinned to the job. Replacing a file makes a new version; jobs keep the one their customer approved.</div>
          </div>
          <select aria-label="Show" value={view} onChange={(e) => setView(e.target.value)} className="h-9 rounded-[8px] px-2.5 text-[14px] font-semibold" style={{ border: "1px solid rgba(242,238,232,.3)", backgroundColor: BAND, color: TITLE }}>
            <option value="active">Active ({active.length})</option>
            <option value="retired">Retired ({retiredCount})</option>
            <option value="all">All ({state.guides.length})</option>
          </select>
          <input ref={addRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Guide PDF" onChange={addFile} />
          <input ref={replaceRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Replacement PDF" onChange={replaceFile} />
          <button type="button" disabled={Boolean(busy)} onClick={() => addRef.current?.click()} className={BTN} style={{ backgroundColor: "#B8955A", color: "#1d160a" }}>
            <Upload style={{ width: "16px", height: "16px" }} /> Add guide
          </button>
        </div>
      </section>

      {(busy || message) && (
        <div role="status" className="rounded-[12px] border bg-white p-3 text-[14px]" style={{ borderColor: message?.tone === "bad" ? LATE : "#B3A792", color: message?.tone === "bad" ? LATE : INK }}>
          {busy || message.text}
        </div>
      )}

      <section className="overflow-hidden rounded-[12px]" style={{ backgroundColor: "#FFFFFF", border: "1px solid #B3A792" }}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ backgroundColor: HEAD_BG, borderBottom: `2px solid ${STRONG}` }}>
                {[["#", "left"], ["Guide", "left"], ["Builder default", "left"], ["Per opening", "right"], ["Version", "right"], ["Jobs", "right"], ["", "right"]].map(([l, a]) => (
                  <th key={l || "menu"} className={th} style={{ ...cell, color: STRONG, textAlign: a }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((g, i) => (
                editing === g.id ? (
                  <tr key={g.id} style={{ backgroundColor: "#FAF8F3" }}>
                    <td className={td} style={{ ...cell, color: SECONDARY }}>{g.active === false ? "—" : i + 1}</td>
                    <td colSpan={6} style={cell}><EditRow guide={g} builders={builders} busy={Boolean(busy)} onSave={saveEdit(g)} onCancel={() => setEditing("")} /></td>
                  </tr>
                ) : [
                  <tr key={g.id} style={{ opacity: g.active === false ? 0.7 : 1 }}>
                    <td className={`${td} tabular-nums`} style={{ ...cell, color: SECONDARY }}>{g.active === false ? "—" : i + 1}</td>
                    <td className={td} style={{ ...cell, color: INK }}>
                      <button type="button" onClick={() => openFile(g.file_uri)} className="m-0 border-0 bg-transparent p-0 text-left text-[14px] font-semibold hover:underline" style={{ color: INK }}>{g.name}</button>
                      {g.description ? <div className="text-[13px]" style={{ color: STRONG }}>{g.description}</div> : null}
                      <div className="text-[13px]" style={{ color: SECONDARY }}>{sizeLabel(g.size)} · PDF{g.active === false ? " · Retired" : ""}</div>
                    </td>
                    <td className={td} style={{ ...cell, color: g.builder_match ? INK : SECONDARY }}>{g.builder_match || "—"}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`} style={{ ...cell, color: g.price_per_opening != null ? INK : SECONDARY }}>{g.price_per_opening != null ? money(g.price_per_opening) : "—"}</td>
                    <td className={`${td} text-right tabular-nums`} style={{ ...cell, color: INK }}>v{g.version || 1}</td>
                    <td className={`${td} text-right tabular-nums`} style={{ ...cell, color: INK }}>{jobCount.get(g.id) || 0}</td>
                    <td className={`${td} text-right`} style={{ ...cell, padding: "3px 8px" }}>
                      <RowMenu items={[
                        { label: "Open PDF", onSelect: () => openFile(g.file_uri) },
                        { label: "Edit details", onSelect: () => setEditing(g.id) },
                        g.active !== false && i > 0 && view === "active" && { label: "Move up", onSelect: () => move(g.id, -1) },
                        g.active !== false && i < active.length - 1 && view === "active" && { label: "Move down", onSelect: () => move(g.id, 1) },
                        { label: "Replace file (new version)", onSelect: () => { replaceTarget.current = g; replaceRef.current?.click(); } },
                        history(g).length > 1 && { label: historyOf === g.id ? "Hide versions" : "Version history", onSelect: () => setHistoryOf(historyOf === g.id ? "" : g.id) },
                        g.active === false ? { label: "Offer again", onSelect: () => setActive(g, true) } : { label: "Retire", danger: true, onSelect: () => setActive(g, false) },
                      ]} />
                    </td>
                  </tr>,
                  historyOf === g.id ? (
                    <tr key={`${g.id}-history`} style={{ backgroundColor: "#FAF8F3" }}>
                      <td style={cell} />
                      <td colSpan={6} className="text-[13px]" style={{ ...cell, color: STRONG }}>
                        {[...history(g)].reverse().map((v) => (
                          <div key={v.version} className="flex flex-wrap gap-x-3 py-0.5">
                            <button type="button" onClick={() => openFile(v.file_uri)} className="m-0 border-0 bg-transparent p-0 text-[13px] font-semibold hover:underline" style={{ color: INK }}>Version {v.version}</button>
                            <span>{v.file_name}</span><span>{sizeLabel(v.size)}</span><span>{dayLabel(v.uploaded_at)}</span>
                            {v.version === (g.version || 1) ? <span className="font-semibold">Current</span> : null}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ) : null,
                ]
              ))}
              {!shown.length && (
                <tr><td colSpan={7} className="text-[14px]" style={{ ...cell, color: SECONDARY }}>
                  {state.guides.length ? "No guides in this view." : (
                    <span className="flex flex-wrap items-center gap-3">
                      No guides yet. Add a PDF, or bring in the guides from Drive › INSTALL BUDGET SHEET › Install Type Guides once.
                      <button type="button" disabled={Boolean(busy)} onClick={importDrive} className={`${BTN} border`} style={{ borderColor: RULE, color: STRONG, background: "#FFFFFF" }}>Import from Drive</button>
                    </span>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}

export default function InstallGuides() {
  const { user } = useAuth();
  if (!isAgentCenterOwner(user)) return <PageShell><p>Install guides are available to the owner.</p></PageShell>;
  return <InstallGuidesContent />;
}

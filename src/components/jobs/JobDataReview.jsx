import { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { buildDuplicateReviewPairs, buildNameReviewRows } from "@/lib/jobNameReview";
import { C } from "@/lib/feeUI";

const ids = (values) => (values || []).map(String).filter(Boolean);

const details = (job) => [job.address, job.customer_name || job.builder,
  ids(job.po_numbers).length ? `BFS PO ${ids(job.po_numbers).join(", ")}` : "",
  ids(job.oe_numbers).length ? `OE ${ids(job.oe_numbers).join(", ")}` : ""].filter(Boolean).join(" · ");

export default function JobDataReview({ jobs, onJobsChange }) {
  const [tab, setTab] = useState("names");
  const [approved, setApproved] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const rows = useMemo(() => buildNameReviewRows(jobs).filter((r) => r.changed || r.ambiguous), [jobs]);
  const pairs = useMemo(() => buildDuplicateReviewPairs(jobs), [jobs]);

  const applyName = async (row) => {
    if (!approved.has(row.job.id) || row.ambiguous) return;
    setBusy(row.job.id); setMessage("");
    const aliases = [...new Set([...(row.job.aliases || []), row.original].filter(Boolean))];
    try {
      await base44.entities.Jobs.update(row.job.id, { canonical_name: row.proposed, aliases });
      onJobsChange((all) => all.map((j) => j.id === row.job.id ? { ...j, canonical_name: row.proposed, aliases } : j));
      setApproved((old) => { const next = new Set(old); next.delete(row.job.id); return next; });
      setMessage(`Renamed ${row.job.id}. Original retained as a searchable alias.`);
    } catch (error) { setMessage(`Rename failed: ${error?.message || "unknown error"}`); }
    finally { setBusy(""); }
  };

  const keepSeparate = async (pair) => {
    const key = `${pair.a.id}:${pair.b.id}`;
    if (!window.confirm(`Keep ${pair.a.id} and ${pair.b.id} as separate jobs? No records or links will be changed.`)) return;
    setBusy(key); setMessage("");
    const aEx = [...new Set([...ids(pair.a.duplicate_exclusions), String(pair.b.id)])];
    const bEx = [...new Set([...ids(pair.b.duplicate_exclusions), String(pair.a.id)])];
    try {
      await Promise.all([base44.entities.Jobs.update(pair.a.id, { duplicate_exclusions: aEx }), base44.entities.Jobs.update(pair.b.id, { duplicate_exclusions: bEx })]);
      onJobsChange((all) => all.map((j) => j.id === pair.a.id ? { ...j, duplicate_exclusions: aEx } : j.id === pair.b.id ? { ...j, duplicate_exclusions: bEx } : j));
      setMessage("Marked not duplicate. Both jobs and all related links remain unchanged.");
    } catch (error) { setMessage(`Review update failed: ${error?.message || "unknown error"}`); }
    finally { setBusy(""); }
  };

  return <div className="p-6 max-w-6xl mx-auto w-full">
    <div className="mb-5"><h2 className="font-heading text-2xl font-bold" style={{ color: C.text }}>Job data review</h2><p className="text-sm mt-1" style={{ color: C.textMuted }}>Owner-only preview. Nothing is renamed or merged automatically; every change requires an explicit decision.</p></div>
    <div className="flex gap-2 mb-5">{[["names", `Name proposals (${rows.length})`], ["duplicates", `Possible duplicates (${pairs.length})`]].map(([key, label]) => <button type="button" key={key} onClick={() => setTab(key)} className="px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: tab === key ? C.accent : C.card, color: tab === key ? "white" : C.text, border: `1px solid ${C.border}` }}>{label}</button>)}</div>
    {message && <p role="status" className="mb-4 p-3 rounded-lg text-sm" style={{ background: C.amberLight, color: C.text }}>{message}</p>}
    {tab === "names" ? <div className="space-y-3">{rows.map((row) => <div key={row.job.id} className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}><div className="flex flex-wrap justify-between gap-4"><div className="min-w-0"><div className="text-xs font-mono" style={{ color: C.textMuted }}>ID {row.job.id}</div><div className="mt-2 text-sm line-through" style={{ color: C.textMuted }}>{row.original || "(blank name)"}</div><div className="font-semibold" style={{ color: C.text }}>{row.proposed || "No name proposed"}</div>{row.collisionIds.length > 0 && <div className="text-xs mt-2" style={{ color: C.amber }}><AlertTriangle className="inline h-3 w-3 mr-1" />Collision with {row.collisionIds.join(", ")}; left untouched.</div>}</div>{!row.ambiguous && <div className="flex items-center gap-2"><label className="text-xs"><input type="checkbox" checked={approved.has(row.job.id)} onChange={(e) => setApproved((old) => { const next = new Set(old); e.target.checked ? next.add(row.job.id) : next.delete(row.job.id); return next; })} className="mr-2" />Confirm this row</label><button type="button" disabled={!approved.has(row.job.id) || busy === row.job.id} onClick={() => applyName(row)} className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: C.accent, color: "white" }}><Check className="inline h-3 w-3 mr-1" />Apply rename</button></div>}</div></div>)}</div>
    : <div className="space-y-3">{pairs.map((pair) => { const key = `${pair.a.id}:${pair.b.id}`; return <div key={key} className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}><div className="flex gap-2 items-center text-xs font-semibold" style={{ color: C.amber }}><Copy className="h-4 w-4" />Evidence: {pair.evidence.join(" + ")}</div><div className="grid md:grid-cols-2 gap-3 my-3">{[pair.a, pair.b].map((job) => <div key={job.id} className="rounded-lg p-3" style={{ background: C.cardAlt }}><div className="font-semibold">{job.canonical_name || "(blank name)"}</div><div className="text-xs font-mono mt-1">ID {job.id}</div><div className="text-xs mt-1" style={{ color: C.textMuted }}>{details(job) || "No related identifying data"}</div></div>)}</div><div className="flex justify-end"><button type="button" disabled={busy === key} onClick={() => keepSeparate(pair)} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ border: `1px solid ${C.border}` }}>Mark not duplicate</button></div></div>; })}</div>}
  </div>;
}

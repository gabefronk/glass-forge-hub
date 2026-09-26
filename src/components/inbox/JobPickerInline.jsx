import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { btnBase, btnNeutral } from "@/components/inbox/inboxApi";

// Small inline picker for linking a ledger entry to a job: the agent's own candidates first,
// then a text search through jobFinder (find_job). Choosing a result calls onPick(job).
export default function JobPickerInline({ candidates = [], onPick, onClose, busy }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); setSearching(false); return undefined; }
    const mine = ++seq.current;
    setSearching(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const r = await base44.functions.invoke("jobFinder", { action: "find_job", query, limit: 8 });
        if (mine !== seq.current) return;
        if (r.data?.error) throw new Error(r.data.detail || r.data.error);
        setResults((r.data?.results || []).filter((x) => x.job_id));
      } catch (e) {
        if (mine === seq.current) { setResults([]); setError(e?.message || "Job search failed."); }
      } finally { if (mine === seq.current) setSearching(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const row = (key, name, sub, job) => (
    <li key={key}>
      <button type="button" disabled={busy} onClick={() => onPick(job)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[9px] px-3 text-left transition-colors hover:bg-[var(--gf-hover)] disabled:opacity-50" style={{ border: `1px solid ${C.rowBorder}` }}>
        <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: C.text }}>{name}</span>
        {sub ? <span className="shrink-0 text-[11px]" style={{ color: C.textMuted }}>{sub}</span> : null}
      </button>
    </li>
  );

  return (
    <div className="mt-2 rounded-[12px] p-3" style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4" style={{ color: C.textFaint }} />
          <input ref={inputRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job, address, PO, lot" aria-label="Search jobs to link"
            className="min-h-11 w-full rounded-[9px] bg-white pl-9 pr-3 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={{ border: `1px solid ${C.border}`, color: C.text }} />
        </label>
        <button type="button" onClick={onClose} aria-label="Close job picker" className={btnBase} style={btnNeutral}><X className="h-4 w-4" /></button>
      </div>
      {error ? <p role="alert" className="mt-2 text-[12px]" style={{ color: "var(--gf-error)" }}>{error}</p> : null}
      {candidates.length > 0 && !q.trim() ? (
        <div className="mt-2.5">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: C.textMuted }}>Agent suggestions</div>
          <ul className="space-y-1.5">{candidates.map((c) => row(`c-${c.job_id}`, c.name || "Job", c.score != null ? `${Math.round(Number(c.score) * 100)}% match` : "", { id: c.job_id, name: c.name }))}</ul>
        </div>
      ) : null}
      {q.trim().length >= 2 ? (
        <div className="mt-2.5">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: C.textMuted }}>{searching ? "Searching…" : results.length ? "Matches" : "No jobs match"}</div>
          <ul className="space-y-1.5">{results.map((r) => row(`r-${r.job_id}`, r.name || "Job", [r.builder, r.address].filter(Boolean).join(" · "), { id: r.job_id, name: r.name }))}</ul>
        </div>
      ) : null}
    </div>
  );
}

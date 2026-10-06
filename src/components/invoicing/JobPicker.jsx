import { useMemo, useState } from "react";
import { Search, Link2, Check } from "lucide-react";

// Inline job picker for an invoice line. Searches the Hub's jobs by name or job
// id, shows candidates, and on a manual pick calls onConfirm(job). Nothing is
// auto-linked: the user must choose. If the line is already linked, the current
// job is shown and switching to a different one requires a confirm step.
const inputStyle = {
  backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "var(--r-control)",
  padding: "8px 10px", color: "var(--gf-ink)", fontFamily: "var(--font-body)",
  fontSize: "14px", outline: "none", width: "100%",
};

export default function JobPicker({ jobs, currentJobId, onConfirm, onCancel }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const list = (jobs || []).filter((j) => !j.merged_into && !j.is_sample);
    const needle = q.trim().toLowerCase();
    if (!needle) return list.slice(0, 12);
    return list.filter((j) =>
      [j.canonical_name, j.name, j.builder, j.address, j.id, ...(j.po_numbers || [])]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle))
    ).slice(0, 20);
  }, [q, jobs]);

  const current = (jobs || []).find((j) => j.id === currentJobId) || null;

  const choose = (job) => {
    if (currentJobId && currentJobId === job.id) { onCancel?.(); return; }
    if (currentJobId && currentJobId !== job.id) {
      const curName = current?.canonical_name || current?.name || "the current job";
      const newName = job.canonical_name || job.name || job.id;
      if (!window.confirm(`Change this line's link from "${curName}" to "${newName}"?`)) return;
    }
    onConfirm(job);
  };

  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--gf-teal-halo)", backgroundColor: "var(--gf-card)" }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[12px] font-semibold" style={{ color: "var(--gf-ink-2)" }}>Link to job</span>
        <button onClick={onCancel} className="text-[12px] font-medium" style={{ color: "var(--gf-ink-3)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Close</button>
      </div>
      {current && (
        <div className="mb-2 rounded-lg px-2.5 py-2 text-[12.5px]" style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-field)", color: "var(--gf-ink-2)" }}>
          Currently linked: <b style={{ color: "var(--gf-ink)" }}>{current.canonical_name || current.name || current.id}</b>
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4" style={{ color: "var(--gf-ink-3)" }} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by job name or job ID" style={{ ...inputStyle, paddingLeft: "30px" }} />
      </div>
      <div className="mt-2 flex flex-col gap-1 max-h-64 overflow-y-auto">
        {results.length === 0 ? (
          <div className="text-[12.5px] py-3 text-center" style={{ color: "var(--gf-ink-3)" }}>No jobs match “{q}”.</div>
        ) : results.map((j) => (
          <button key={j.id} onClick={() => choose(j)} className="text-left rounded-lg px-2.5 py-2" style={{ border: "1px solid var(--gf-border)", backgroundColor: j.id === currentJobId ? "var(--gf-teal-050)" : "var(--gf-card)", cursor: "pointer" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold truncate" style={{ color: "var(--gf-ink)" }}>{j.canonical_name || j.name || "Job"}</span>
              {j.id === currentJobId
                ? <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--gf-teal-600)" }} />
                : <Link2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--gf-ink-3)" }} />}
            </div>
            <div className="text-[11px] truncate" style={{ color: "var(--gf-ink-3)" }}>{[j.builder, j.address].filter(Boolean).join(" · ") || j.id}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
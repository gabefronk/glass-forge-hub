import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/feeMath";

// Inline form for creating a profit-split fee line (no modal).
// Job is a type-ahead: pick an existing job or type a new name to auto-create.
export default function ProfitSplitForm({ jobs, onSaved, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [jobQuery, setJobQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [date, setDate] = useState(today);
  const [salePrice, setSalePrice] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  const filteredJobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return [];
    return jobs.filter(j => {
      const name = (j.canonical_name || "").toLowerCase();
      const aliases = (j.aliases || []).join(" ").toLowerCase();
      const addr = (j.address || "").toLowerCase();
      const pos = (j.po_numbers || []).join(" ").toLowerCase();
      const oes = (j.oe_numbers || []).join(" ").toLowerCase();
      return [name, aliases, addr, pos, oes].some(s => s.includes(q));
    }).slice(0, 8);
  }, [jobs, jobQuery]);

  const sale = Number(salePrice) || 0;
  const costNum = Number(cost) || 0;
  const profit = sale - costNum;
  const split = 0.5;
  const feeAmt = Math.round(profit * split * 100) / 100;

  const handleSubmit = async () => {
    if (!date || !salePrice || !cost) return;
    setSaving(true);
    try {
      let jobId = selectedJob?.id || null;
      let jobName = selectedJob?.canonical_name || jobQuery.trim();
      if (!jobId && jobName) {
        const newJob = await base44.entities.Jobs.create({
          canonical_name: jobName,
          aliases: [jobName],
        });
        jobId = newJob.id;
      }
      if (!jobId || !jobName) return;
      await onSaved({ jobId, jobName, date, salePrice: sale, cost: costNum });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-[#fef3c7] p-4 mb-4 border-l-4 border-l-[#f59e0b]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#fef3c7] text-foreground">Profit Split</span>
        <span className="text-xs text-muted-foreground">New profit-split job</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Job</label>
          <input
            type="text"
            value={selectedJob ? selectedJob.canonical_name : jobQuery}
            onChange={(e) => { setJobQuery(e.target.value); setSelectedJob(null); }}
            placeholder="Search or type new job name..."
            className="w-full mt-1 text-sm border border-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-foreground"
          />
          {filteredJobs.length > 0 && !selectedJob && (
            <div className="mt-1 rounded border border-border bg-white max-h-40 overflow-auto">
              {filteredJobs.map(j => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => { setSelectedJob(j); setJobQuery(""); }}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted text-foreground"
                >
                  {j.canonical_name}
                  {j.address && <span className="text-xs text-muted-foreground ml-2">· {j.address}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full mt-1 text-sm border border-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-foreground"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sale Price $</label>
          <input
            type="number"
            step="0.01"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            placeholder="0.00"
            className="w-full mt-1 text-sm border border-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-foreground"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cost $</label>
          <input
            type="number"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
            className="w-full mt-1 text-sm border border-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-foreground"
          />
        </div>
      </div>
      {salePrice && cost && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Profit:</span>
          <span className="font-semibold tabular-nums">${formatMoney(profit)}</span>
          <span className="text-muted-foreground">× 50% =</span>
          <span className="font-bold tabular-nums text-accent">${formatMoney(feeAmt)}</span>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={saving || !date || !salePrice || !cost || (!selectedJob && !jobQuery.trim())}>
          {saving ? "Saving…" : "Add profit-split row"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
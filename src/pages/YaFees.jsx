import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import TopBar from "@/components/fees/TopBar";
import NeedsReviewSection from "@/components/fees/NeedsReviewSection";
import FeeTable from "@/components/fees/FeeTable";
import { computeFeeAmt, computeLaborAmt, currentMonthStr, invoiceTotal, invoiceTotalByType, laborTotal, futureLaborTotal, futureFeeTotal, suppressedLaborRows } from "@/lib/feeMath";
import ScheduledSection from "@/components/fees/ScheduledSection";
import ProfitSplitForm from "@/components/fees/ProfitSplitForm";

export default function YaFees() {
  const [month, setMonth] = useState(currentMonthStr());
  const [feeLines, setFeeLines] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [fl, jb] = await Promise.all([
        base44.entities.FeeLines.list(),
        base44.entities.Jobs.list(),
      ]);
      setFeeLines(fl);
      setJobs(jb);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const topBarRef = useRef(null);
  const [topBarH, setTopBarH] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setTopBarH(topBarRef.current?.offsetHeight || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const jobsById = useMemo(() => {
    const m = {};
    for (const j of jobs) m[j.id] = j;
    return m;
  }, [jobs]);

  const [showSplitForm, setShowSplitForm] = useState(false);

  const monthRows = useMemo(
    () => feeLines.filter((r) => r.invoice_month === month),
    [feeLines, month]
  );

  // Annotate rows with double-count suppression flag.
  const annotatedRows = useMemo(() => {
    const suppressed = suppressedLaborRows(monthRows);
    return monthRows.map((r) => ({ ...r, _suppressed: suppressed.has(r.id) }));
  }, [monthRows]);

  const reviewRows = useMemo(
    () => monthRows.filter((r) => r.needs_review),
    [monthRows]
  );

  const totals = useMemo(() => {
    const byType = invoiceTotalByType(annotatedRows);
    return {
      invoice: byType.total,
      bfsFees: byType.laborPct,
      splitFees: byType.profitSplit,
      labor: laborTotal(annotatedRows),
      count: monthRows.length,
      futureLabor: futureLaborTotal(annotatedRows),
      futureFee: futureFeeTotal(annotatedRows),
    };
  }, [annotatedRows, monthRows]);

  const handleEdit = async (id, patch) => {
    // local optimistic
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const merged = { ...row, ...patch, manually_adjusted: true };
    const isProfitSplit = merged.fee_type === 'profit_split';
    const recomputeTriggers = isProfitSplit
      ? (patch.sale_price !== undefined || patch.cost !== undefined || patch.split_pct !== undefined)
      : (patch.labor_amt !== undefined || patch.fee_pct !== undefined);
    if (recomputeTriggers) {
      if (isProfitSplit) {
        const sale = Number(merged.sale_price) || 0;
        const cost = Number(merged.cost) || 0;
        const split = merged.split_pct != null ? Number(merged.split_pct) : 0.5;
        merged.fee_amt = Math.round((sale - cost) * split * 100) / 100;
      } else {
        merged.labor_amt = computeLaborAmt({ ...merged, manually_adjusted: true });
        merged.fee_amt = computeFeeAmt({ ...merged, manually_adjusted: true });
      }
    }
    setFeeLines((prev) => prev.map((r) => (r.id === id ? merged : r)));
    const { id: _id, created_date, updated_date, created_by_id, ...rest } = merged;
    await base44.entities.FeeLines.update(id, rest);
  };

  const handleAccept = async (id) => {
    handleEdit(id, { needs_review: false, manually_adjusted: true });
  };

  const handleAssignToJob = async (lineId, jobId) => {
    const line = feeLines.find((r) => r.id === lineId);
    const job = jobs.find((j) => j.id === jobId);
    if (!line || !job) return;
    // append job_name_norm to job aliases
    const aliases = Array.from(new Set([...(job.aliases || []), line.job_name_norm]));
    const updatedJob = { ...job, aliases };
    setJobs((prev) => prev.map((j) => (j.id === jobId ? updatedJob : j)));
    await base44.entities.Jobs.update(jobId, { aliases });
    // link the line
    handleEdit(lineId, { job_id: jobId, needs_review: false, manually_adjusted: true });
  };

  const handleCreateJob = async (lineId) => {
    const line = feeLines.find((r) => r.id === lineId);
    if (!line) return;
    const rawName = line.job_name_raw || line.job_name_norm;
    const builder = (() => {
      const s = String(rawName).replace(/^ya\b\s*[-–—]?\s*/i, "").trim();
      const m = s.match(/^([A-Z][A-Za-z0-9&\s.'-]+?)\s*[-–—]\s*/);
      return m ? m[1].trim() : null;
    })();
    const newJob = await base44.entities.Jobs.create({
      canonical_name: line.job_name_norm,
      aliases: [line.job_name_norm],
      po_numbers: line.po_number ? [line.po_number] : [],
      oe_numbers: line.oe_number ? [line.oe_number] : [],
      builder,
    });
    setJobs((prev) => [...prev, newJob]);
    handleEdit(lineId, { job_id: newJob.id, needs_review: false, manually_adjusted: true });
  };

  const handleCreateSplit = async ({ jobId, jobName, date, salePrice, cost }) => {
    const sale = Number(salePrice) || 0;
    const costNum = Number(cost) || 0;
    const split = 0.5;
    const feeAmt = Math.round((sale - costNum) * split * 100) / 100;
    const row = await base44.entities.FeeLines.create({
      job_id: jobId,
      job_date: date,
      invoice_month: date.slice(0, 7),
      job_name_raw: jobName,
      job_name_norm: jobName,
      line_description: `Profit split — sale $${sale.toFixed(2)} / cost $${costNum.toFixed(2)}`,
      fee_type: 'profit_split',
      sale_price: sale,
      cost: costNum,
      split_pct: split,
      labor_amt: 0,
      fee_pct: 0,
      fee_amt: feeAmt,
      billable: true,
      source: 'app',
      written_by: 'app',
      match_confidence: 'high',
      needs_review: false,
      manually_adjusted: true,
    });
    setFeeLines((prev) => [...prev, row]);
    setShowSplitForm(false);
  };

  const handleExport = () => {
    const cols = ["job_date", "job_name_norm", "line_description", "labor_amt", "fee_pct", "fee_amt", "billable", "source", "match_confidence", "needs_review", "manually_adjusted"];
    const header = cols.join(",");
    const body = monthRows.map((r) =>
      cols.map((c) => {
        const v = r[c];
        if (v == null) return "";
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ).join("\n");
    const csv = header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ya-fees-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <TopBar
        month={month}
        onMonthChange={setMonth}
        invoiceTotalVal={totals.invoice}
        bfsFeesVal={totals.bfsFees}
        splitFeesVal={totals.splitFees}
        laborTotalVal={totals.labor}
        lineCount={totals.count}
        futureLaborVal={totals.futureLabor}
        onExport={handleExport}
        topRef={topBarRef}
      />
      <div className="px-4 sm:px-8 pt-6">
        <h1 className="font-heading text-2xl font-bold uppercase tracking-tight">YA Fees</h1>
      </div>
      <NeedsReviewSection
        rows={reviewRows}
        jobs={jobs}
        onAccept={handleAccept}
        onAssignToJob={handleAssignToJob}
        onCreateJob={handleCreateJob}
      />
      <ScheduledSection rows={annotatedRows} />
      <FeeTable
        rows={annotatedRows}
        jobsById={jobsById}
        onEdit={handleEdit}
        stickyTop={topBarH}
        onAddSplit={() => setShowSplitForm((v) => !v)}
        splitForm={showSplitForm && (
          <ProfitSplitForm jobs={jobs} onSaved={handleCreateSplit} onCancel={() => setShowSplitForm(false)} />
        )}
      />
    </div>
  );
}
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import TopBar from "@/components/fees/TopBar";
import Toolbar from "@/components/fees/Toolbar";
import NotYetBilled from "@/components/fees/NotYetBilled";
import NeedsReviewSection from "@/components/fees/NeedsReviewSection";
import FeeTable from "@/components/fees/FeeTable";
import ProfitSplitForm from "@/components/fees/ProfitSplitForm";
import { computeFeeAmt, computeLaborAmt, currentMonthStr, invoiceTotalByType, laborTotal, futureLaborTotal, futureFeeTotal, suppressedLaborRows, isFutureRow, paymentStats, filterRows } from "@/lib/feeMath";
import { workType, billingTier, isZeroRow } from "@/lib/feeUI";

function matchesLegend(row, key) {
  switch (key) {
    case "install": return workType(row) === "install";
    case "service": return workType(row) === "service";
    case "zero": return workType(row) === "zero";
    case "split": return row.fee_type === "profit_split";
    case "gabe": return billingTier(row) === "gabe";
    case "mine": return billingTier(row) === "mine";
    default: return true;
  }
}

export default function YaFees() {
  const [month, setMonth] = useState(currentMonthStr());
  const [feeLines, setFeeLines] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [legendFilter, setLegendFilter] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hideZeros, setHideZeros] = useState(false);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [fl, jb] = await Promise.all([
        base44.entities.FeeLines.filter({ invoice_month: month }, "-job_date", 5000),
        base44.entities.Jobs.list("-created_date", 5000),
      ]);
      setDebugInfo({
        month,
        feeLinesType: Array.isArray(fl) ? "array" : typeof fl,
        feeLinesLen: Array.isArray(fl) ? fl.length : (fl ? Object.keys(fl).length : 0),
        feeLinesRaw: JSON.stringify(fl).slice(0, 300),
        jobsType: Array.isArray(jb) ? "array" : typeof jb,
        jobsLen: Array.isArray(jb) ? jb.length : (jb ? Object.keys(jb).length : 0),
        hasToken: !!(base44?.auth?.token || base44?._token),
      });
      setFeeLines(Array.isArray(fl) ? fl : []);
      setJobs(Array.isArray(jb) ? jb : []);
    } catch (e) {
      console.error("YaFees load error:", e);
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

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

  const monthRows = useMemo(() => feeLines.filter((r) => r.invoice_month === month), [feeLines, month]);

  const annotatedRows = useMemo(() => {
    const suppressed = suppressedLaborRows(monthRows);
    return monthRows.map((r) => ({ ...r, _suppressed: suppressed.has(r.id) }));
  }, [monthRows]);

  const filteredRows = useMemo(() => {
    let rows = filterRows(annotatedRows, filter);
    if (legendFilter) rows = rows.filter((r) => matchesLegend(r, legendFilter));
    return rows;
  }, [annotatedRows, filter, legendFilter]);

  const payStats = useMemo(() => paymentStats(annotatedRows), [annotatedRows]);

  const reviewRows = useMemo(() => monthRows.filter((r) => r.needs_review), [monthRows]);

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

  // ── Selection handlers ─────────────────────────────────────────────
  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (ids) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Edit / delete ────────────────────────────────────────────────────
  const handleEdit = async (id, patch) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    if (patch.invoiced_to_ya === true && !row.paid_to_ya && !patch.paid_to_ya) patch.paid_to_ya = true;
    if (patch.paid_to_ya === false) patch.invoiced_to_ya = false;
    const merged = { ...row, ...patch, manually_adjusted: true };
    const isProfitSplit = merged.fee_type === "profit_split";
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

  const handleDelete = async (id) => {
    setFeeLines((prev) => prev.filter((r) => r.id !== id));
    await base44.entities.FeeLines.delete(id);
  };

  const handleAccept = async (id) => {
    handleEdit(id, { needs_review: false, manually_adjusted: true });
  };

  const handleAssignToJob = async (lineId, jobId) => {
    const line = feeLines.find((r) => r.id === lineId);
    const job = jobs.find((j) => j.id === jobId);
    if (!line || !job) return;
    const aliases = Array.from(new Set([...(job.aliases || []), line.job_name_norm]));
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, aliases } : j)));
    await base44.entities.Jobs.update(jobId, { aliases });
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
      job_id: jobId, job_date: date, invoice_month: date.slice(0, 7),
      job_name_raw: jobName, job_name_norm: jobName,
      line_description: `Profit split — sale $${sale.toFixed(2)} / cost $${costNum.toFixed(2)}`,
      fee_type: "profit_split", sale_price: sale, cost: costNum, split_pct: split,
      labor_amt: 0, fee_pct: 0, fee_amt: feeAmt, billable: true,
      source: "app", written_by: "app", match_confidence: "high",
      needs_review: false, manually_adjusted: true,
    });
    setFeeLines((prev) => [...prev, row]);
    setShowSplitForm(false);
  };

  // ── Bulk actions ────────────────────────────────────────────────────
  const handleBulkSetSelected = async (field, value) => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const updates = selected.map((r) => {
      const patch = { [field]: value, manually_adjusted: true };
      if (field === "invoiced_to_ya" && value && !r.paid_to_ya) patch.paid_to_ya = true;
      if (field === "paid_to_ya" && !value) patch.invoiced_to_ya = false;
      return { id: r.id, ...patch };
    });
    setFeeLines((prev) => prev.map((r) => {
      const u = updates.find((u) => u.id === r.id);
      return u ? { ...r, ...u } : r;
    }));
    await base44.entities.FeeLines.bulkUpdate(updates);
    clearSelection();
  };

  const handleMarkAllBilled = async () => {
    const unbilled = annotatedRows.filter((r) => !r.billed_to_bfs && !isFutureRow(r) && !isZeroRow(r));
    if (!unbilled.length) return;
    const updates = unbilled.map((r) => ({ id: r.id, billed_to_bfs: true, manually_adjusted: true }));
    setFeeLines((prev) => prev.map((r) => {
      const u = updates.find((u) => u.id === r.id);
      return u ? { ...r, ...u } : r;
    }));
    await base44.entities.FeeLines.bulkUpdate(updates);
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

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-screen p-8">
        <div className="max-w-lg rounded-lg border border-red-300 bg-red-50 p-6">
          <h2 className="text-lg font-bold text-red-800 mb-2">Failed to load data</h2>
          <p className="text-sm text-red-700 mb-3">An error occurred while fetching fee lines:</p>
          <pre className="text-xs text-red-900 bg-red-100 rounded p-3 overflow-auto whitespace-pre-wrap">{loadError.message || String(loadError)}</pre>
          <button onClick={load} className="mt-4 px-4 py-2 bg-red-800 text-white rounded text-sm font-medium">Retry</button>
        </div>
      </div>
    );
  }

  if (debugInfo && debugInfo.feeLinesLen === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="max-w-lg rounded-lg border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-bold text-amber-800 mb-2">Debug: 0 fee lines returned</h2>
          <p className="text-sm text-amber-700 mb-3">The query succeeded but returned no data. Diagnostic info:</p>
          <pre className="text-xs text-amber-900 bg-amber-100 rounded p-3 overflow-auto whitespace-pre-wrap">{JSON.stringify(debugInfo, null, 2)}</pre>
          <button onClick={load} className="mt-4 px-4 py-2 bg-amber-800 text-white rounded text-sm font-medium">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#f3f3f1", minHeight: "100vh" }}>
      <TopBar
        topRef={topBarRef}
        month={month}
        onMonthChange={setMonth}
        onExport={handleExport}
        invoiceTotal={totals.invoice}
        notYetBilledTotal={payStats.notBilled?.total || 0}
        notYetBilledCount={payStats.notBilled?.count || 0}
        bfsFees={totals.bfsFees}
        laborTotal={totals.labor}
        lineCount={totals.count}
        scheduledLabor={totals.futureLabor}
        awaitingPayment={payStats.awaitingPayment?.total || 0}
        awaitingPaymentCount={payStats.awaitingPayment?.count || 0}
      />
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        legendFilter={legendFilter}
        onLegendFilterChange={setLegendFilter}
        rows={annotatedRows}
        selectedCount={selectedIds.size}
        onClearSelection={clearSelection}
        onBulkSetSelected={handleBulkSetSelected}
        onAddSplit={() => setShowSplitForm((v) => !v)}
      />
      {showSplitForm && (
        <div className="px-4 sm:px-8 pt-4">
          <ProfitSplitForm jobs={jobs} onSaved={handleCreateSplit} onCancel={() => setShowSplitForm(false)} />
        </div>
      )}
      <NeedsReviewSection
        rows={reviewRows}
        jobs={jobs}
        onAccept={handleAccept}
        onAssignToJob={handleAssignToJob}
        onCreateJob={handleCreateJob}
      />
      <NotYetBilled
        rows={annotatedRows}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        hideZeros={hideZeros}
        onHideZerosChange={setHideZeros}
        onEdit={handleEdit}
        onMarkAllBilled={handleMarkAllBilled}
      />
      <FeeTable
        rows={filteredRows}
        jobsById={jobsById}
        onEdit={handleEdit}
        onDelete={handleDelete}
        stickyTop={topBarH}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
      />
    </div>
  );
}
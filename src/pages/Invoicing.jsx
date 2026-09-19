import { refreshMonth } from "@/lib/refreshMonth";
import { invoicingStats } from "@/lib/invoicingStats";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { computeFeeAmt, computeLaborAmt, currentMonthStr, withComputedAmounts } from "@/lib/feeMath";
import { isReady, isMatchBlocked, isReportBlocked, buildSupersededSet, withCompanions } from "@/lib/invoicingFilters";
import InvoiceHeader from "@/components/invoicing/InvoiceHeader";
import InvoiceSummary from "@/components/invoicing/InvoiceSummary";
import InvoiceToolbar from "@/components/invoicing/InvoiceToolbar";
import LineList from "@/components/invoicing/LineList";
import JobsView from "@/components/invoicing/JobsView";
import FloatingActionBar from "@/components/invoicing/FloatingActionBar";
import UnprocessedEventsBanner from "@/components/invoicing/UnprocessedEventsBanner";
import LineDetailsDrawer from "@/components/invoicing/LineDetailsDrawer";
import JobProfitabilityPanel from "@/components/invoicing/JobProfitabilityPanel";

export default function Invoicing() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonthStr());
  const [feeLines, setFeeLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => localStorage.getItem("inv_view") || "lines");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(() => localStorage.getItem("inv_sort") || "date");
  const [hideZeros, setHideZeros] = useState(() => localStorage.getItem("inv_hideZeros") === "true");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [undo, setUndo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [runningIngest, setRunningIngest] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [unprocessedCount, setUnprocessedCount] = useState(0);
  const [monthClosed, setMonthClosed] = useState(null);
  const [closing, setClosing] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [editRequestId, setEditRequestId] = useState(null);
  const [reportStatusMap, setReportStatusMap] = useState(new Map());
  const [billingEvents, setBillingEvents] = useState([]);
  const [profitabilityInputs, setProfitabilityInputs] = useState({ jobs: [], quotes: [], costs: [] });
  const [reportAttached, setReportAttached] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("inv_reportAttached") || "[]")); } catch { return new Set(); }
  });
  const lastClickedIndex = useRef(null);
  const searchRef = useRef(null);
  const undoTimer = useRef(null);

  useEffect(() => { localStorage.setItem("inv_view", view); }, [view]);
  useEffect(() => { localStorage.setItem("inv_sort", sort); }, [sort]);
  useEffect(() => { localStorage.setItem("inv_hideZeros", String(hideZeros)); }, [hideZeros]);
  useEffect(() => { localStorage.setItem("inv_reportAttached", JSON.stringify([...reportAttached])); }, [reportAttached]);

  // Ignore responses from an older load (e.g. after quickly switching months).
  const loadSeq = useRef(0);
  const load = async () => {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    setLoading(true);
    try {
      const [fl, calEvents, jobs, quotes, costs] = await Promise.all([
        base44.entities.FeeLines.list("-job_date", 5000),
        base44.entities.CalendarEvents.list("-event_date", 5000),
        base44.entities.Jobs.list("canonical_name", 5000).catch(() => []),
        base44.entities.QuoteRequests.list("-updated_date", 5000).catch(() => []),
        base44.entities.JobCostInputs?.filter ? base44.entities.JobCostInputs.filter({ month }, "job_name_norm", 5000).catch(() => []) : Promise.resolve([]),
      ]);
      if (stale()) return;
      const rsm = new Map();
      for (const e of (Array.isArray(calEvents) ? calEvents : [])) {
        if (e.google_event_id) rsm.set(e.google_event_id, e.report_status);
      }
      setReportStatusMap(rsm);
      setBillingEvents(Array.isArray(calEvents) ? calEvents : []);
      setFeeLines(withComputedAmounts(fl));
      setProfitabilityInputs({ jobs: Array.isArray(jobs) ? jobs : [], quotes: Array.isArray(quotes) ? quotes : [], costs: Array.isArray(costs) ? costs : [] });
      setLoadError("");
      window.dispatchEvent(new Event("billing-updated"));
      const feeEventIds = new Set((Array.isArray(fl) ? fl : []).map((f) => f.calendar_event_id).filter(Boolean));
      const unprocessed = (Array.isArray(calEvents) ? calEvents : []).filter(
        (e) => (e.event_date || "").startsWith(month) && e.source === "google" && e.google_event_id && !feeEventIds.has(e.google_event_id)
      );
      setUnprocessedCount(unprocessed.length);
      try {
        const snapshots = await base44.entities.MonthCloseSnapshot.list("-created_date", 100);
        const snap = (Array.isArray(snapshots) ? snapshots : []).find((s) => s.month === month);
        if (!stale()) setMonthClosed(snap || null);
      } catch { if (!stale()) setMonthClosed(null); }
    } catch (e) {
      if (!stale()) setLoadError("Could not load billing data. " + (e.message || "Try refresh."));
    } finally {
      if (!stale()) setLoading(false);
    }
  };
  useEffect(() => { load(); }, [month]);

  // Display copies: $0 ProBuild twins fold into their calendar labor line and priced
  // companions are held for review. Writes always start from the raw feeLines rows.
  const billingRows = useMemo(() => withCompanions(feeLines, billingEvents), [feeLines, billingEvents]);
  const monthRows = useMemo(() => billingRows.filter((r) => r.invoice_month === month), [billingRows, month]);
  const supersededSet = useMemo(() => buildSupersededSet(billingRows, billingEvents), [billingRows, billingEvents]);

  const filteredRows = useMemo(() => {
    let rows = monthRows.filter((r) => !supersededSet.has(r.id));
    if (filter === "ready") rows = rows.filter((r) => isReady(r, reportStatusMap, supersededSet));
    else if (filter === "needs_review") rows = rows.filter(isMatchBlocked);
    else if (filter === "needs_report") rows = rows.filter((r) => isReportBlocked(r, reportStatusMap));
    else if (filter === "billed") rows = rows.filter((r) => r.billed_to_bfs);
    if (hideZeros) rows = rows.filter((r) => computeFeeAmt(r) !== 0 || isMatchBlocked(r) || r.fee_type === "profit_split");
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        [r.line_description, r.job_name_raw, r.job_name_norm, r.po_number, r.oe_number, r.note_text]
          .filter(Boolean)
          .some((s) => s.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [monthRows, filter, hideZeros, search, reportStatusMap, supersededSet]);

  // Counted over the rows the lists show (superseded and folded twins are hidden).
  const filterCounts = useMemo(() => {
    const shown = monthRows.filter((r) => !supersededSet.has(r.id));
    return {
      all: shown.length,
      ready: shown.filter((r) => isReady(r, reportStatusMap, supersededSet)).length,
      needs_review: shown.filter(isMatchBlocked).length,
      needs_report: shown.filter((r) => isReportBlocked(r, reportStatusMap)).length,
      billed: shown.filter((r) => r.billed_to_bfs).length,
    };
  }, [monthRows, reportStatusMap, supersededSet]);

  const heroStats = useMemo(() => invoicingStats(monthRows, reportStatusMap, supersededSet), [monthRows, reportStatusMap, supersededSet]);

  const selectedFee = useMemo(() => {
    return monthRows.filter((r) => selectedIds.has(r.id)).reduce((s, r) => s + (computeFeeAmt(r) || 0), 0);
  }, [monthRows, selectedIds]);

  const performAction = useCallback((message, doFn, undoFn) => {
    doFn();
    setUndo({ message, undoFn });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, []);

  const handleUndo = useCallback(() => {
    setUndo((prev) => { if (prev?.undoFn) prev.undoFn(); return null; });
    clearTimeout(undoTimer.current);
  }, []);

  const toggleRow = useCallback((id) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    lastClickedIndex.current = filteredRows.findIndex((r) => r.id === id);
  }, [filteredRows]);

  const shiftClickRow = useCallback((id) => {
    const currentIndex = filteredRows.findIndex((r) => r.id === id);
    if (lastClickedIndex.current === null || currentIndex === -1) { toggleRow(id); return; }
    const start = Math.min(lastClickedIndex.current, currentIndex);
    const end = Math.max(lastClickedIndex.current, currentIndex);
    setSelectedIds((prev) => { const next = new Set(prev); for (let i = start; i <= end; i++) next.add(filteredRows[i].id); return next; });
  }, [filteredRows, toggleRow]);

  const toggleDay = useCallback((dayRows) => {
    const allSelected = dayRows.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => { const next = new Set(prev); if (allSelected) dayRows.forEach((r) => next.delete(r.id)); else dayRows.forEach((r) => next.add(r.id)); return next; });
  }, [selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const clearEditRequest = useCallback(() => setEditRequestId(null), []);

  const handleSelectAllReady = useCallback(() => {
    setSelectedIds(new Set(monthRows.filter((r) => isReady(r, reportStatusMap, supersededSet)).map((r) => r.id)));
  }, [monthRows, reportStatusMap, supersededSet]);

  const handleEdit = useCallback(async (id, patch) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    // A patch may carry manually_adjusted explicitly (undo restores the prior value).
    const merged = { ...row, manually_adjusted: true, ...patch };
    const isProfitSplit = merged.fee_type === "profit_split";
    const recomputeTriggers = isProfitSplit
      ? (patch.sale_price !== undefined || patch.cost !== undefined || patch.split_pct !== undefined || patch.fee_type !== undefined)
      : (patch.labor_amt !== undefined || patch.fee_pct !== undefined || patch.fee_type !== undefined);
    if (recomputeTriggers) {
      if (isProfitSplit) {
        const sale = Number(merged.sale_price) || 0;
        const cost = Number(merged.cost) || 0;
        const split = merged.split_pct != null ? Number(merged.split_pct) : 0.5;
        merged.fee_amt = Math.round((sale - cost) * split * 100) / 100;
      } else {
        merged.labor_amt = computeLaborAmt({ ...merged, manually_adjusted: true });
        merged.fee_amt = Math.round((Number(merged.labor_amt) || 0) * (Number(merged.fee_pct) || 0) * 100) / 100;
      }
    }
    setFeeLines((prev) => prev.map((r) => (r.id === id ? merged : r)));
    const { id: _id, created_date, updated_date, created_by_id, ...rest } = merged;
    try {
      await base44.entities.FeeLines.update(id, rest);
    } catch (err) {
      setFeeLines((prev) => prev.map((r) => (r.id === id ? row : r)));
      setSyncMessage(`Save failed; the line was restored. ${err?.message || ""}`.trim());
    }
  }, [feeLines]);

  // Optimistic bulk writes: restore the previous values if the save fails.
  const persistBulk = useCallback((updates, restore) => {
    base44.entities.FeeLines.bulkUpdate(updates).catch((err) => {
      setFeeLines((prev) => prev.map((r) => { const u = restore.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      setSyncMessage(`Save failed; the lines were restored. ${err?.message || ""}`.trim());
    });
  }, []);

  const handleDelete = useCallback(async (id) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const { id: _id, created_date, updated_date, created_by_id, ...rest } = row;
    setFeeLines((prev) => prev.filter((r) => r.id !== id));
    try {
      await base44.entities.FeeLines.delete(id);
    } catch (err) {
      setFeeLines((prev) => [...prev, row]);
      performAction(`Delete failed: ${err?.message || err}`, () => {}, () => {});
      return;
    }
    performAction("Line deleted", () => {}, async () => { const restored = await base44.entities.FeeLines.create(rest); setFeeLines((prev) => [...prev, restored]); });
    setDetailRow(null);
  }, [feeLines, performAction]);

  const handleAddReport = useCallback(() => { navigate("/calendar"); }, [navigate]);

  const handleMarkBilled = useCallback((id, value = true) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const prev = { billed_to_bfs: row.billed_to_bfs, manually_adjusted: !!row.manually_adjusted };
    handleEdit(id, { billed_to_bfs: value });
    performAction(value ? "Line marked billed" : "Line reopened", () => {}, () => handleEdit(id, prev));
  }, [feeLines, handleEdit, performAction]);

  const handleMarkBilledSelected = useCallback(() => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const updates = selected.map((r) => ({ id: r.id, billed_to_bfs: true, manually_adjusted: true }));
    const prevStates = selected.map((r) => ({ id: r.id, billed_to_bfs: r.billed_to_bfs, manually_adjusted: !!r.manually_adjusted }));
    setFeeLines((prev) => prev.map((r) => { const u = updates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    persistBulk(updates, prevStates);
    performAction(`${selected.length} lines marked billed`, () => {}, () => {
      setFeeLines((prev) => prev.map((r) => { const u = prevStates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      persistBulk(prevStates, updates);
    });
    clearSelection();
  }, [feeLines, selectedIds, performAction, clearSelection, persistBulk]);

  const handleSetFeePctSelected = useCallback((pct) => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const feePct = pct / 100;
    const updates = selected.map((r) => ({ id: r.id, fee_pct: feePct, fee_amt: Math.round((Number(r.labor_amt) || 0) * feePct * 100) / 100, manually_adjusted: true }));
    const prevStates = selected.map((r) => ({ id: r.id, fee_pct: r.fee_pct, fee_amt: r.fee_amt, manually_adjusted: !!r.manually_adjusted }));
    setFeeLines((prev) => prev.map((r) => { const u = updates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    persistBulk(updates, prevStates);
    performAction(`Fee set to ${pct}%`, () => {}, () => {
      setFeeLines((prev) => prev.map((r) => { const u = prevStates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      persistBulk(prevStates, updates);
    });
  }, [feeLines, selectedIds, performAction, persistBulk]);

  const handleDeleteSelected = useCallback(async () => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const deletedData = selected.map((r) => { const { id, created_date, updated_date, created_by_id, ...rest } = r; return rest; });
    setFeeLines((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    try {
      await Promise.all(selected.map((r) => base44.entities.FeeLines.delete(r.id)));
    } catch (err) {
      setFeeLines((prev) => [...prev, ...selected]);
      performAction(`Delete failed: ${err?.message || err}`, () => {}, () => {});
      return;
    }
    performAction(`${selected.length} lines deleted`, () => {}, async () => { const restored = await base44.entities.FeeLines.bulkCreate(deletedData); setFeeLines((prev) => [...prev, ...restored]); });
    clearSelection();
  }, [feeLines, selectedIds, performAction, clearSelection]);

  const handleExportSelected = useCallback(() => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const cols = ["job_date", "job_name_norm", "line_description", "labor_amt", "fee_pct", "fee_amt", "billable", "source", "billed_to_bfs"];
    const header = cols.join(",");
    const body = selected.map((r) => cols.map((c) => { const v = r[c]; if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `selected-lines-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [feeLines, selectedIds, month]);

  // Only lines that are ready to bill; held, scheduled, superseded and excluded lines stay put.
  const isLineReady = useCallback((r) => isReady(r, reportStatusMap, supersededSet), [reportStatusMap, supersededSet]);

  const handleBillJob = useCallback((job) => {
    const lines = job.lines.filter(isLineReady);
    if (!lines.length) return;
    const updates = lines.map((r) => ({ id: r.id, billed_to_bfs: true, manually_adjusted: true }));
    const prevStates = lines.map((r) => ({ id: r.id, billed_to_bfs: r.billed_to_bfs, manually_adjusted: !!r.manually_adjusted }));
    setFeeLines((prev) => prev.map((r) => { const u = updates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    persistBulk(updates, prevStates);
    performAction(`Job "${job.name}" billed (${lines.length} ready ${lines.length === 1 ? "line" : "lines"})`, () => {}, () => {
      setFeeLines((prev) => prev.map((r) => { const u = prevStates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      persistBulk(prevStates, updates);
    });
  }, [performAction, persistBulk, isLineReady]);

  const handleExportJob = useCallback((job) => {
    const cols = ["job_date", "line_description", "labor_amt", "fee_pct", "fee_amt", "billed_to_bfs"];
    const header = cols.join(",");
    const body = job.lines.map((r) => cols.map((c) => { const v = r[c]; if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `job-${job.name}-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [month]);

  const handleRunIngest = async () => {
    setRunningIngest(true);
    try {
      const result = await refreshMonth(month, setSyncMessage);
      await load();
      setSyncMessage("Month refreshed: calendar, ProBuild, pricing and report checks." + (result.fetchCalendarEvents?.locked_months?.includes(month) ? " Billing rows are locked for this imported or closed month." : ""));
    } catch (e) {
      setSyncMessage("Refresh incomplete. " + e.message);
      await load();
    } finally {
      setRunningIngest(false);
    }
  };

  const handleCloseMonth = async () => {
    if (monthClosed) {
      if (!window.confirm(`This month is already closed ($${(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)?.toFixed(2)} invoiced on ${new Date(monthClosed.closed_at).toLocaleDateString()}). Create a new snapshot with current values?`)) return;
    } else {
      if (!window.confirm(`Close ${month} and create an immutable snapshot of all billed lines? This captures line IDs, amounts, and totals so the month can be verified later even if data changes.`)) return;
    }
    setClosing(true);
    try {
      const res = await base44.functions.invoke("closeMonthSnapshot", { month, force: !!monthClosed });
      // The function reports failures as HTTP 200 with an `error` field.
      const result = res?.data || {};
      if (result.error === "already_closed") window.alert(`Already closed on ${new Date(result.closed_at).toLocaleDateString()}.`);
      else if (result.error) window.alert(`Month was not closed: ${result.error}`);
      const snapshots = await base44.entities.MonthCloseSnapshot.list("-created_date", 100);
      const snap = (Array.isArray(snapshots) ? snapshots : []).find((s) => s.month === month);
      setMonthClosed(snap || null);
    } catch (e) {
      console.error("Close month error:", e);
      window.alert(`Month was not closed: ${e?.response?.data?.error || e?.message || "unknown error"}`);
    }
    finally { setClosing(false); }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const { exportInvoicePdf } = await import("@/lib/exportInvoicePdf");
      const exportRows = monthRows
        .filter((r) => isReady(r, reportStatusMap, supersededSet))
        .map((r) => ({ ...r, labor_amt: computeLaborAmt(r), fee_amt: computeFeeAmt(r) }));
      await exportInvoicePdf(month, exportRows);
    } catch (e) {
      console.error("PDF export error:", e);
      setSyncMessage(`PDF export failed. ${e?.message || ""}`.trim());
    }
    finally { setExporting(false); }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Leave typing alone: Ctrl+A / Ctrl+Enter / Escape inside a field belong to that field.
      if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "a") { e.preventDefault(); setSelectedIds(new Set(filteredRows.map((r) => r.id))); return; }
      if (e.key === "Escape") { setSelectedIds(new Set()); setDetailRow(null); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { if (selectedIds.size > 0) handleMarkBilledSelected(); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filteredRows, selectedIds, handleMarkBilledSelected]);

  const today = new Date();
  const currentMonth = currentMonthStr();
  const isPast = month < currentMonth;
  const isFutureM = month > currentMonth;
  const showEmptyState = monthRows.length === 0 && (isPast || isFutureM);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: "#F5F6F3" }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: "#DDE0DA", borderTopColor: "#146556" }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#F5F6F3", minHeight: "100vh" }}>
      <InvoiceHeader
        month={month}
        onMonthChange={setMonth}
        onExportPdf={handleExportPdf}
        exporting={exporting}
        monthClosed={monthClosed}
        onCloseMonth={handleCloseMonth}
        closing={closing}
        onRefresh={handleRunIngest}
        refreshing={runningIngest}
        syncMessage={syncMessage}
        loadError={loadError}
      />

      <div className="mx-auto min-w-0 max-w-[1440px] px-5 sm:px-6 lg:px-8" style={{ paddingBottom: selectedIds.size > 0 ? "220px" : "60px" }}>
        {showEmptyState ? (
          <div style={{ padding: "120px 0", textAlign: "center" }}>
            <p className="text-[17px]" style={{ color: "#53615B", marginBottom: "8px" }}>
              {isPast ? "No billing rows loaded for this month." : "No data for this month yet."}
            </p>
            <p className="text-[13px]" style={{ color: "#8A958F", marginBottom: "20px" }}>
              {isPast ? "Refresh this month to check the source calendars and ProBuild." : "Come back after the first jobs are posted."}
            </p>
            <button onClick={() => setMonth(currentMonth)} className="min-h-10 rounded-lg px-5 text-[13px] font-medium" style={{ border: "1px solid #DDE0DA", backgroundColor: "#FFFFFF", color: "#104E44", cursor: "pointer" }}>
              Back to {new Date().toLocaleDateString("en-US", { month: "long" })}
            </button>
          </div>
        ) : (
          <>
            {unprocessedCount > 0 && (
              <UnprocessedEventsBanner count={unprocessedCount} onRun={handleRunIngest} running={runningIngest} />
            )}
            <InvoiceSummary
              {...heroStats}
              month={month}
              onFilterBlocked={() => setFilter("needs_report")}
              onFilterMatchBlocked={() => setFilter("needs_review")}
            />
            <JobProfitabilityPanel
              rows={monthRows.filter((r) => !supersededSet.has(r.id))}
              jobs={profitabilityInputs.jobs}
              quotes={profitabilityInputs.quotes}
              costInputs={profitabilityInputs.costs}
              reportStatusMap={reportStatusMap}
              supersededSet={supersededSet}
            />
            <div style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-card)", overflow: "hidden", position: "relative", marginTop: "16px" }}>
            <InvoiceToolbar
              search={search}
              onSearchChange={setSearch}
              searchRef={searchRef}
              view={view}
              onViewChange={setView}
              filter={filter}
              onFilterChange={setFilter}
              filterCounts={filterCounts}
              sort={sort}
              onSortChange={setSort}
              hideZeros={hideZeros}
              onHideZerosChange={() => setHideZeros(!hideZeros)}
              lineCount={filteredRows.length}
              readyCount={heroStats.readyCount}
              onSelectAllReady={handleSelectAllReady}
            />
            {view === "lines" ? (
              <LineList
                rows={filteredRows.map(r => ({ ...r, _reportBlocked: isReportBlocked(r, reportStatusMap) }))}
                sort={sort}
                selectedIds={selectedIds}
                onToggle={toggleRow}
                onShiftClick={shiftClickRow}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddReport={handleAddReport}
                onMarkBilled={handleMarkBilled}
                onOpenJob={() => {}}
                onOpenDetails={setDetailRow}
                reportAttached={reportAttached}
                onToggleDay={toggleDay}
                onClearFilters={() => { setFilter("all"); setSearch(""); setHideZeros(false); }}
                editRequestId={editRequestId}
                onEditRequestHandled={clearEditRequest}
              />
            ) : (
              <JobsView
                rows={filteredRows}
                isLineReady={isLineReady}
                onBillJob={handleBillJob}
                onExportJob={handleExportJob}
                onOpenJob={() => {}}
              />
            )}
            </div>
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <FloatingActionBar
          selectedCount={selectedIds.size}
          selectedFee={selectedFee}
          onClear={clearSelection}
          onSetFeePct={handleSetFeePctSelected}
          onDelete={handleDeleteSelected}
          onExport={handleExportSelected}
          onMarkBilled={handleMarkBilledSelected}
        />
      )}

      {detailRow && (
        <LineDetailsDrawer
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onEdit={(id) => { setDetailRow(null); setView("lines"); setEditRequestId(id); }}
          onDelete={handleDelete}
          onMarkBilled={handleMarkBilled}
          onOpenJob={(jobId) => { setDetailRow(null); navigate(`/jobs/${jobId}`); }}
        />
      )}

      {undo && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", zIndex: 60, backgroundColor: "#1B2925", border: "1px solid #2A3A35", borderRadius: "99px", padding: "10px 16px", maxWidth: "calc(100vw - 32px)", width: "max-content", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 8px 24px -12px rgba(24,36,34,.30)" }}>
          <span className="text-[13px]" style={{ color: "#E8EAE5" }}>{undo.message}</span>
          <button onClick={handleUndo} className="text-[11px] font-semibold rounded-full px-2.5 py-1" style={{ border: "1px solid #3A4A44", backgroundColor: "#2A3A35", color: "#146556", cursor: "pointer" }}>Undo</button>
        </div>
      )}
    </div>
  );
}
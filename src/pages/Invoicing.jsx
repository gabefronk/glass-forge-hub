import { isIgnoredWorkItem, denverDate } from "../../base44/shared/billingCore.js";
import { refreshMonth } from "@/lib/refreshMonth";
import { invoicingStats } from "@/lib/invoicingStats";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { procurementPath } from "@/lib/procurementRoutes";
import { inInvoiceScope, selectedInvoiceRows } from "@/lib/invoiceScope";
import { selectedReadyInvoiceRows, selectedLaborFeeRows, deleteInvoiceRows } from "@/lib/invoiceActions";
import { validMonth } from "../../base44/shared/procurementCore.js";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { SheetCard, TILE } from "@/components/PageShell";
import { Receipt } from "lucide-react";
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
import BudgetEstimateNote from "@/components/invoicing/BudgetEstimateNote";
import NeedsConfirmationList from "@/components/invoicing/NeedsConfirmationList";
import RecordInvoiceDialog from "@/components/invoicing/RecordInvoiceDialog";
import InvoiceRegister from "@/components/invoicing/InvoiceRegister";
import { laborInvoicePlan, linePatches, reopenPatch, paymentLinePatches, priorState, invoiceRegister, isCoveredZeroReview } from "@/lib/invoiceRegister";
import DateRangeBar from "@/components/invoicing/dashboard/DateRangeBar";
import DashboardCards from "@/components/invoicing/dashboard/DashboardCards";
import RevenueSplitPanel from "@/components/invoicing/dashboard/RevenueSplitPanel";
import DashboardLineList from "@/components/invoicing/dashboard/DashboardLineList";
import { resolveDashboardRange, dashboardData, inDashboardRange, dashboardMonthGroups } from "@/lib/invoiceDashboard";
import { useAuth } from "@/lib/AuthContext";

export default function Invoicing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const focusedJobId = params.get('job_id') || '';
  const requestedMonth = params.get('month') || '';
  const [month, setMonth] = useState(() => validMonth(requestedMonth) ? requestedMonth : currentMonthStr());
  useEffect(() => { if (validMonth(requestedMonth)) setMonth(requestedMonth); }, [requestedMonth]);
  const changeMonth = value => { setMonth(value); const p = new URLSearchParams(params); p.set('month', value); setParams(p); };
  const [feeLines, setFeeLines] = useState([]);
  const [loading, setLoading] = useState(true);
  // One-time default: everyone lands on the new Dashboard once; after that their
  // stored choice wins (flag set on the first persist below).
  const [view, setView] = useState(() =>
    localStorage.getItem("inv_view_migrated") === "1"
      ? localStorage.getItem("inv_view") || "dashboard"
      : "dashboard"
  );
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(() => localStorage.getItem("inv_sort") || "date");
  const [hideZeros, setHideZeros] = useState(() => localStorage.getItem("inv_hideZeros") === "true");
  const [dashPreset, setDashPreset] = useState(() => localStorage.getItem("inv_dash_preset") || "this_month");
  const [dashCustom, setDashCustom] = useState({ start: "", end: "" });
  const [dashIncludeDrafts, setDashIncludeDrafts] = useState(() => localStorage.getItem("inv_dash_inc_drafts") !== "false");
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
  const [billRequest, setBillRequest] = useState(null);
  const [invoices, setInvoices] = useState([]);
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
  const deleting = useRef(false);
  const [deletingRows, setDeletingRows] = useState(false);

  useEffect(() => { setSelectedIds(new Set()); setDetailRow(null); setUndo(null); lastClickedIndex.current = null; clearTimeout(undoTimer.current); }, [month, focusedJobId]);
  useEffect(() => { if (focusedJobId && view === "dashboard") setView("lines"); }, [focusedJobId, view]);
  useEffect(() => { localStorage.setItem("inv_view", view); localStorage.setItem("inv_view_migrated", "1"); }, [view]);
  useEffect(() => { localStorage.setItem("inv_sort", sort); }, [sort]);
  useEffect(() => { localStorage.setItem("inv_hideZeros", String(hideZeros)); }, [hideZeros]);
  useEffect(() => { localStorage.setItem("inv_dash_preset", dashPreset); }, [dashPreset]);
  useEffect(() => { localStorage.setItem("inv_dash_inc_drafts", String(dashIncludeDrafts)); }, [dashIncludeDrafts]);
  useEffect(() => { localStorage.setItem("inv_reportAttached", JSON.stringify([...reportAttached])); }, [reportAttached]);

  // Ignore responses from an older load (e.g. after quickly switching months).
  const loadSeq = useRef(0);
  const load = async () => {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    setLoading(true);
    try {
      const [fl, calEvents, jobs, quotes, costs, invs] = await Promise.all([
        base44.entities.FeeLines.list("-job_date", 5000),
        base44.entities.CalendarEvents.list("-event_date", 5000),
        base44.entities.Jobs.list("canonical_name", 5000).catch(() => []),
        base44.entities.QuoteRequests.list("-updated_date", 5000).catch(() => []),
        base44.entities.JobCostInputs?.filter ? base44.entities.JobCostInputs.filter({ month }, "job_name_norm", 5000).catch(() => []) : Promise.resolve([]),
        base44.entities.Invoices.list("-invoice_date", 2000).catch(() => []),
      ]);
      if (stale()) return;
      const rsm = new Map();
      for (const e of (Array.isArray(calEvents) ? calEvents : [])) {
        if (e.google_event_id) rsm.set(e.google_event_id, e.report_status);
      }
      setReportStatusMap(rsm);
      setBillingEvents(Array.isArray(calEvents) ? calEvents : []);
      setFeeLines(withComputedAmounts(fl));
      setInvoices(Array.isArray(invs) ? invs : []);
      setProfitabilityInputs({ jobs: Array.isArray(jobs) ? jobs : [], quotes: Array.isArray(quotes) ? quotes : [], costs: Array.isArray(costs) ? costs : [] });
      setLoadError("");
      window.dispatchEvent(new Event("billing-updated"));
      const feeEventIds = new Set((Array.isArray(fl) ? fl : []).map((f) => f.calendar_event_id).filter(Boolean));
      // A profit-split event is billable even with $0 labor (fee from sale price − cost),
      // so only exclude zero-labor events whose notes carry no profit-split markers.
      const hasProfitSplitMarker = (notes) => /\$\s?\d/i.test(String(notes || "")) && /(sale\s+price|project\s+total|package\s+cost|material\s+cost|\bprofit\b|\bsplit\b)/i.test(String(notes || ""));
      const isExcludedFromBanner = (e) => {
        if (isIgnoredWorkItem(e) || e.source_status === "cancelled") return true; // canceled recurring placeholders never bill
        if ((Number(e.labor_amt) || 0) === 0 && !hasProfitSplitMarker(e.scope_notes)) return true; // non-billing zero-labor (e.g. jobsite walks)
        return false;
      };
      const unprocessed = (Array.isArray(calEvents) ? calEvents : []).filter(
        (e) => (!focusedJobId || e.job_id === focusedJobId) && (e.event_date || "").startsWith(month) && e.source === "google" && e.google_event_id && !feeEventIds.has(e.google_event_id) && !isExcludedFromBanner(e)
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
  useEffect(() => { if (user?.role === 'user') { setLoading(false); return; } load(); }, [month, focusedJobId, user?.role]);

  // Display copies: $0 ProBuild twins fold into their calendar labor line and priced
  // companions are held for review. Writes always start from the raw feeLines rows.
  const billingRows = useMemo(() => withCompanions(feeLines, billingEvents), [feeLines, billingEvents]);
  const monthRows = useMemo(() => billingRows.filter(r => inInvoiceScope(r, month, focusedJobId)), [billingRows, month, focusedJobId]);
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

  // Dashboard view: same FeeLines rows over a date range instead of one month.
  const dashToday = denverDate();
  const dashRange = useMemo(() => resolveDashboardRange(dashPreset, dashToday, dashCustom.start, dashCustom.end), [dashPreset, dashCustom.start, dashCustom.end, dashToday]);
  const dashData = useMemo(() => dashboardData(billingRows, { range: dashRange, reportStatusMap, supersededSet, today: dashToday, includeDrafts: dashIncludeDrafts }), [billingRows, dashRange, reportStatusMap, supersededSet, dashToday, dashIncludeDrafts]);
  const dashGroups = useMemo(() => {
    let rows = billingRows.filter((r) => inDashboardRange(r, dashRange) && !(r.customer_collection_state && r.customer_collection_state !== "paid") && !supersededSet.has(r.id) && !r._companion_folded);
    if (hideZeros) rows = rows.filter((r) => computeFeeAmt(r) !== 0 || isMatchBlocked(r) || r.fee_type === "profit_split");
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => [r.line_description, r.job_name_raw, r.job_name_norm, r.po_number, r.oe_number, r.note_text].filter(Boolean).some((s) => s.toLowerCase().includes(q)));
    }
    return dashboardMonthGroups(rows);
  }, [billingRows, dashRange, supersededSet, hideZeros, search]);
  const dashLineCount = useMemo(() => dashGroups.reduce((n, g) => n + g.rows.length, 0), [dashGroups]);

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
    if (deleting.current) return;
    const row = feeLines.find((r) => r.id === id);
    if (!row || (focusedJobId && !inInvoiceScope(row, month, focusedJobId))) return;
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
  }, [feeLines, month, focusedJobId]);

  // Optimistic bulk writes: restore the previous values if the save fails.
  const persistBulk = useCallback((updates, restore) => {
    base44.entities.FeeLines.bulkUpdate(updates).catch((err) => {
      setFeeLines((prev) => prev.map((r) => { const u = restore.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      setSyncMessage(`Save failed; the lines were restored. ${err?.message || ""}`.trim());
    });
  }, []);

  const handleDelete = useCallback(async (id) => {
    if (deleting.current) return;
    const row = feeLines.find((r) => r.id === id);
    if (!row || (focusedJobId && !inInvoiceScope(row, month, focusedJobId))) return;
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
  }, [feeLines, month, focusedJobId, performAction]);

  const handleAddReport = useCallback(() => { navigate("/calendar"); }, [navigate]);

  // Ready: save the edits and clear the review hold so the line shows as Ready
  // (the same Ready status the list already derives via isReady). Replaces the old
  // Save + Mark billed buttons. Does not touch fee_pct beyond the edited value.
  const handleReady = useCallback((id, patch) => {
    handleEdit(id, { ...patch, needs_review: false, pricing_review_reason: null, billable: true });
  }, [handleEdit]);

  // Send for Review: flag the line for the YA crew (Israel) to confirm labor/details.
  // Only the new optional flag fields are written; no existing data is changed.
  const handleSendForReview = useCallback(async (id) => {
    if (deleting.current) return;
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const me = await base44.auth.me().catch(() => null);
    const patch = { sent_for_review: true, sent_for_review_at: new Date().toISOString(), sent_for_review_by: me?.email || "" };
    setFeeLines((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try { await base44.entities.FeeLines.update(id, patch); }
    catch (err) { setFeeLines((prev) => prev.map((r) => (r.id === id ? row : r))); setSyncMessage(`Could not send for review. ${err?.message || ""}`.trim()); }
  }, [feeLines]);

  // Link to Job: save the chosen job's id (and the denormalized name the list and
  // job page read) on the fee line. Manual only — the picker never auto-links.
  const handleLinkJob = useCallback(async (id, job) => {
    if (deleting.current) return;
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const prev = { job_id: row.job_id, job_name_norm: row.job_name_norm };
    const patch = { job_id: job.id, job_name_norm: job.canonical_name || job.name || "" };
    setFeeLines((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try { await base44.entities.FeeLines.update(id, patch); }
    catch (err) {
      setFeeLines((cur) => cur.map((r) => (r.id === id ? { ...r, ...prev } : r)));
      setSyncMessage(`Could not link job. ${err?.message || ""}`.trim());
    }
  }, [feeLines]);

  // Applies a bulk patch optimistically with an undo that restores the prior values.
  const applyBulk = useCallback((updates, prevStates, message) => {
    const apply = (patches) => setFeeLines((prev) => prev.map((r) => { const u = patches.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    apply(updates);
    persistBulk(updates, prevStates);
    performAction(message, () => {}, () => { apply(prevStates); persistBulk(prevStates, updates); });
  }, [persistBulk, performAction]);

  // Every billing path records the QuickBooks invoice the lines went out on: an Invoices
  // record (new, or the existing one with that number) plus its id and number on each line.
  // Returns an error message for the dialog when the invoice cannot be recorded.
  const confirmBill = useCallback(async ({ number, date, customer }) => {
    const rows = billRequest?.rows || [];
    if (!rows.length || deleting.current) { setBillRequest(null); return; }
    const plan = laborInvoicePlan(rows, { number, date, customer }, invoices);
    if (plan.error) return plan.error;
    let invoice;
    try {
      if (plan.create) {
        const me = await base44.auth.me().catch(() => null);
        invoice = await base44.entities.Invoices.create({ ...plan.create, created_by_email: me?.email || "" });
      } else {
        await base44.entities.Invoices.update(plan.existing.id, plan.update);
        invoice = { ...plan.existing, ...plan.update };
      }
    } catch (err) {
      return `The invoice was not recorded. ${err?.message || ""}`.trim();
    }
    const undoInvoice = () => (plan.create ? base44.entities.Invoices.delete(invoice.id) : base44.entities.Invoices.update(plan.existing.id, { amount: plan.existing.amount, fee_amount: plan.existing.fee_amount, line_count: plan.existing.line_count }));
    const restoreInvoices = () => setInvoices((prev) => (plan.create ? prev.filter((i) => i.id !== invoice.id) : prev.map((i) => (i.id === invoice.id ? plan.existing : i))));
    setInvoices((prev) => (plan.create ? [invoice, ...prev] : prev.map((i) => (i.id === invoice.id ? invoice : i))));
    setBillRequest(null);
    const updates = linePatches(rows, invoice);
    const prevStates = priorState(rows, Object.keys(updates[0]).filter((k) => k !== "id"));
    const apply = (patches) => setFeeLines((prev) => prev.map((r) => { const u = patches.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    apply(updates);
    clearSelection();
    try {
      await base44.entities.FeeLines.bulkUpdate(updates);
    } catch (err) {
      apply(prevStates);
      restoreInvoices();
      await undoInvoice().catch(() => {});
      setSyncMessage(`Billing failed; the lines and invoice were restored. ${err?.message || ""}`.trim());
      return;
    }
    performAction(`${rows.length} ${rows.length === 1 ? "line" : "lines"} billed on invoice #${invoice.invoice_number}`, () => {}, async () => {
      apply(prevStates);
      restoreInvoices();
      persistBulk(prevStates, updates);
      await undoInvoice().catch((e) => setSyncMessage(`Undo could not restore the invoice record. ${e?.message || ""}`.trim()));
    });
  }, [billRequest, invoices, clearSelection, performAction, persistBulk]);

  const handleMarkBilled = useCallback((id, value = true) => {
    if (deleting.current) return;
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    if (!value) {
      const patch = reopenPatch();
      applyBulk([{ id, ...patch }], priorState([row], Object.keys(patch)), "Line reopened");
      return;
    }
    const display = billingRows.find((r) => r.id === id);
    if (!display || !isReady(display, reportStatusMap, supersededSet)) { setSyncMessage("This line is not ready to bill. Resolve its review or report hold first."); return; }
    setBillRequest({ rows: [row], label: row.job_name_norm || row.job_name_raw || "" });
  }, [feeLines, billingRows, reportStatusMap, supersededSet, applyBulk]);

  const handleMarkBilledSelected = useCallback(() => {
    if (deleting.current) return;
    if (loading || loadError || monthClosed) { setSyncMessage("Refresh billing data and use an open month before marking lines billed."); return; }
    const selected = selectedReadyInvoiceRows(feeLines, billingRows, selectedIds, month, focusedJobId, reportStatusMap, supersededSet);
    const skipped = selectedInvoiceRows(feeLines, selectedIds, month, focusedJobId).length - selected.length;
    if (skipped) setSyncMessage(`${skipped} selected lines were skipped because they are not ready to bill. Review their status first.`);
    if (!selected.length) return;
    setBillRequest({ rows: selected, label: month });
  }, [feeLines, billingRows, selectedIds, month, focusedJobId, reportStatusMap, supersededSet, loading, loadError, monthClosed]);

  // Payment is recorded on the invoice and copied to its lines.
  const handleRecordPayment = useCallback(async (invoiceId, date) => {
    if (deleting.current) return;
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) return;
    const prevPaid = invoice.paid_date || null;
    const setPaid = (paid) => setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, paid_date: paid } : i)));
    setPaid(date || null);
    try { await base44.entities.Invoices.update(invoiceId, { paid_date: date || null }); }
    catch (err) { setPaid(prevPaid); setSyncMessage(`Payment was not saved. ${err?.message || ""}`.trim()); return; }
    const rows = feeLines.filter((r) => r.invoice_id === invoiceId);
    const updates = paymentLinePatches(rows, invoiceId, date);
    const label = `Invoice #${invoice.invoice_number}`;
    if (updates.length) {
      applyBulk(updates, priorState(rows, ["paid_to_ya", "paid_date"]), date ? `${label} marked paid` : `${label} payment removed`);
    } else {
      performAction(date ? `${label} marked paid` : `${label} payment removed`, () => {}, () => {});
    }
  }, [invoices, feeLines, applyBulk, performAction]);

  // An invoice whose lines were all reopened can be voided; it stays for history.
  const handleVoidInvoice = useCallback(async (invoiceId) => {
    const voided_at = new Date().toISOString();
    try { await base44.entities.Invoices.update(invoiceId, { voided_at }); }
    catch (err) { setSyncMessage(`Invoice was not voided. ${err?.message || ""}`.trim()); return; }
    setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, voided_at } : i)));
  }, []);

  // $0 lines held only to confirm the work was covered by the original install.
  const coveredRows = useMemo(() => {
    const ids = new Set(billingRows.filter((r) => selectedIds.has(r.id) && isCoveredZeroReview(r)).map((r) => r.id));
    return selectedInvoiceRows(feeLines, selectedIds, month, focusedJobId).filter((r) => ids.has(r.id));
  }, [billingRows, feeLines, selectedIds, month, focusedJobId]);

  const handleCoveredSelected = useCallback(() => {
    if (deleting.current || !coveredRows.length) return;
    if (loading || loadError || monthClosed) { setSyncMessage("Refresh billing data and use an open month before confirming lines."); return; }
    const updates = coveredRows.map((r) => ({ id: r.id, manually_adjusted: true }));
    applyBulk(updates, priorState(coveredRows, ["manually_adjusted"]), `${updates.length} $0 ${updates.length === 1 ? "line" : "lines"} confirmed as covered, no charge`);
    clearSelection();
  }, [coveredRows, loading, loadError, monthClosed, applyBulk, clearSelection]);

  const register = useMemo(() => {
    const all = invoiceRegister(invoices, feeLines);
    if (!focusedJobId) return all;
    const ids = new Set(feeLines.filter((r) => r.job_id === focusedJobId && r.invoice_id).map((r) => r.invoice_id));
    return all.filter((i) => ids.has(i.id));
  }, [invoices, feeLines, focusedJobId]);

  const handleSetFeePctSelected = useCallback((pct) => {
    if (deleting.current) return;
    if (loading || loadError || monthClosed) { setSyncMessage("Refresh billing data and use an open month before changing fees."); return; }
    const selected = selectedLaborFeeRows(feeLines, selectedIds, month, focusedJobId);
    const skipped = selectedInvoiceRows(feeLines, selectedIds, month, focusedJobId).length - selected.length;
    if (skipped) setSyncMessage(`${skipped} profit-split lines were skipped. Edit sale, cost and split on each line instead.`);
    if (!selected.length || !Number.isFinite(pct) || pct < 0 || pct > 100) return;
    const feePct = pct / 100;
    const updates = selected.map((r) => ({ id: r.id, fee_pct: feePct, fee_amt: Math.round((Number(r.labor_amt) || 0) * feePct * 100) / 100, manually_adjusted: true }));
    const prevStates = selected.map((r) => ({ id: r.id, fee_pct: r.fee_pct, fee_amt: r.fee_amt, manually_adjusted: !!r.manually_adjusted }));
    setFeeLines((prev) => prev.map((r) => { const u = updates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    persistBulk(updates, prevStates);
    performAction(`Fee set to ${pct}%`, () => {}, () => {
      setFeeLines((prev) => prev.map((r) => { const u = prevStates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      persistBulk(prevStates, updates);
    });
  }, [feeLines, selectedIds, month, focusedJobId, loading, loadError, monthClosed, performAction, persistBulk]);

  const handleDeleteSelected = useCallback(async () => {
    if (deleting.current) return;
    const selected = selectedInvoiceRows(feeLines, selectedIds, month, focusedJobId);
    if (!selected.length) return;
    if (loading || loadError || monthClosed) { setSyncMessage("Refresh billing data and use an open month before deleting lines."); return; }
    deleting.current = true; setDeletingRows(true);
    try {
    const { deleted, failed } = await deleteInvoiceRows(selected, id => base44.entities.FeeLines.delete(id));
    const deletedIds = new Set(deleted.map(row => row.id));
    setFeeLines(prev => prev.filter(row => !deletedIds.has(row.id)));
    if (failed.length) setSyncMessage(`${failed.length} lines could not be deleted and remain in the list. ${deleted.length} were deleted.`);
    if (deleted.length) {
      const deletedData = deleted.map(row => { const { id, created_date, updated_date, created_by_id, ...rest } = row; return rest; });
      performAction(`${deleted.length} lines deleted`, () => {}, async () => {
        try { const restored = await base44.entities.FeeLines.bulkCreate(deletedData); setFeeLines(prev => [...prev, ...restored]); }
        catch (error) { setSyncMessage(`Undo could not restore the deleted lines. Refresh before retrying. ${error?.message || ""}`); }
      });
    }
    clearSelection();
    } finally { deleting.current = false; setDeletingRows(false); }
  }, [feeLines, selectedIds, month, focusedJobId, loading, loadError, monthClosed, performAction, clearSelection]);

  const handleExportSelected = useCallback(() => {
    const selected = selectedInvoiceRows(feeLines, selectedIds, month, focusedJobId);
    if (!selected.length) return;
    const cols = ["job_date", "job_name_norm", "line_description", "labor_amt", "fee_pct", "fee_amt", "billable", "source", "billed_to_bfs", "invoice_number", "invoice_date", "paid_date"];
    const header = cols.join(",");
    const body = selected.map((r) => cols.map((c) => { const v = r[c]; if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `selected-lines-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [feeLines, selectedIds, month, focusedJobId]);

  // Only lines that are ready to bill; held, scheduled, superseded and excluded lines stay put.
  const isLineReady = useCallback((r) => inInvoiceScope(r, month, focusedJobId) && isReady(r, reportStatusMap, supersededSet), [month, focusedJobId, reportStatusMap, supersededSet]);

  const handleBillJob = useCallback((job) => {
    if (deleting.current) return;
    const readyIds = new Set(job.lines.filter(isLineReady).map((r) => r.id));
    const lines = feeLines.filter((r) => readyIds.has(r.id));
    if (!lines.length) return;
    setBillRequest({ rows: lines, label: job.name });
  }, [feeLines, isLineReady]);

  const handleExportJob = useCallback((job) => {
    const cols = ["job_date", "line_description", "labor_amt", "fee_pct", "fee_amt", "billed_to_bfs"];
    const header = cols.join(",");
    const body = job.lines.map((r) => cols.map((c) => { const v = r[c]; if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `job-${job.name}-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [month]);

  const handleRunIngest = async () => {
    if (focusedJobId) { await load(); setSyncMessage('Job billing records reloaded. Global calendar and billing ingest were not run.'); return; }
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
    if (focusedJobId) { setSyncMessage('Month close applies to all jobs. Return to the all-jobs view to close a month.'); return; }
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
  const showEmptyState = view !== "dashboard" && monthRows.length === 0 && (isPast || isFutureM);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: "#DDE0DA", borderTopColor: "#146556" }} />
      </div>
    );
  }

  // YA crew (Israel) only sees the crew confirmation list, never owner-only pricing.
  if (user?.role === 'user') return <NeedsConfirmationList />;

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      {focusedJobId && <div className="mx-auto max-w-[1440px] px-5 pt-5 sm:px-6 lg:px-8"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div><p className="text-sm font-bold text-emerald-950">Job invoicing: {profitabilityInputs.jobs.find(j => j.id === focusedJobId)?.canonical_name || focusedJobId}</p><p className="mt-1 text-xs text-emerald-900">Only records linked to this job. Global ingest and month-close actions stay in the all-jobs view.</p></div><div className="flex flex-wrap gap-3 text-sm font-semibold text-emerald-950"><Link className="underline" to={procurementPath(focusedJobId, 'invoicing', month)}>Budget & Orders</Link><Link className="underline" to={`/?month=${encodeURIComponent(month)}`}>Show all jobs</Link></div></div></div>}
      <InvoiceHeader
        jobScoped={Boolean(focusedJobId)}
        month={month}
        onMonthChange={changeMonth}
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
        {focusedJobId && <BudgetEstimateNote jobId={focusedJobId} month={month} input={profitabilityInputs.costs.find(c => c.job_id === focusedJobId && c.month === month)} />}
        {showEmptyState ? (
          <div style={{ padding: "120px 0", textAlign: "center" }}>
            <p className="text-[17px]" style={{ color: "#53615B", marginBottom: "8px" }}>
              {isPast ? "No billing rows loaded for this month." : "No data for this month yet."}
            </p>
            <p className="text-[13px]" style={{ color: "#8A958F", marginBottom: "20px" }}>
              {isPast ? "Refresh this month to check the source calendars and ProBuild." : "Come back after the first jobs are posted."}
            </p>
            <button onClick={() => changeMonth(currentMonth)} className="min-h-10 rounded-lg px-5 text-[13px] font-medium" style={{ border: "1px solid #DDE0DA", backgroundColor: "#FFFFFF", color: "#104E44", cursor: "pointer" }}>
              Back to {new Date().toLocaleDateString("en-US", { month: "long" })}
            </button>
          </div>
        ) : (
          <>
            {view === "dashboard" && !focusedJobId && (
              <>
                <DateRangeBar
                  preset={dashPreset}
                  onPresetChange={setDashPreset}
                  onCustomChange={(start, end) => setDashCustom({ start, end })}
                  rangeLabel={dashRange.label}
                  rangeStart={dashRange.start}
                  rangeEnd={dashRange.end}
                />
                <DashboardCards buckets={dashData.buckets} rangeLabel={dashRange.label} />
              </>
            )}
            {!(view === "dashboard" && !focusedJobId) && (
              <>
            {unprocessedCount > 0 && !focusedJobId && (
              <UnprocessedEventsBanner count={unprocessedCount} onRun={handleRunIngest} running={runningIngest} />
            )}
            <SheetCard icon={Receipt} tile={TILE.teal} title={focusedJobId ? 'This job / this month' : 'This month'} sub="the total is what is done and reported — nothing counts until it is" className="mt-4" bodyClassName="px-5 max-[699px]:px-4">
              <InvoiceSummary
                {...heroStats}
                month={month}
                onFilterBlocked={() => setFilter("needs_report")}
                onFilterMatchBlocked={() => setFilter("needs_review")}
              />
            </SheetCard>
            <details className="mt-3"><summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm font-medium text-slate-600">Profit & cost details</summary>
            <JobProfitabilityPanel
              rows={monthRows.filter((r) => !supersededSet.has(r.id))}
              jobs={profitabilityInputs.jobs}
              quotes={profitabilityInputs.quotes}
              costInputs={profitabilityInputs.costs}
              reportStatusMap={reportStatusMap}
              supersededSet={supersededSet}
            />
            </details>
              </>
            )}
            <div style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-card)", overflow: "hidden", position: "relative", marginTop: "16px" }}>
            <InvoiceToolbar
              dashboardMode={view === "dashboard" && !focusedJobId}
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
              lineCount={view === "dashboard" && !focusedJobId ? dashLineCount : filteredRows.length}
              readyCount={heroStats.readyCount}
              onSelectAllReady={handleSelectAllReady}
            />
            {filter === "billed" && !(view === "dashboard" && !focusedJobId) && <InvoiceRegister register={register} onRecordPayment={handleRecordPayment} onVoid={handleVoidInvoice} />}
            {view === "dashboard" && !focusedJobId ? (
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]" style={{ alignItems: "start" }}>
                <DashboardLineList
                  groups={dashGroups}
                  onOpenDetails={setDetailRow}
                  reportStatusMap={reportStatusMap}
                  supersededSet={supersededSet}
                  today={dashToday}
                />
                <RevenueSplitPanel
                  split={dashData.split}
                  rangeLabel={dashRange.label}
                  includeDrafts={dashIncludeDrafts}
                  onIncludeDraftsChange={setDashIncludeDrafts}
                  manuallyAdjusted={dashData.manuallyAdjusted}
                  onReview={() => setView("lines")}
                  onViewSplitByJob={() => setView("jobs")}
                  onPartnerStatements={handleExportPdf}
                />
              </div>
            ) : view === "jobs" ? (
              <JobsView
                rows={filteredRows}
                isLineReady={isLineReady}
                onBillJob={handleBillJob}
                onExportJob={handleExportJob}
                onOpenJob={() => {}}
              />
            ) : (
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
                onReady={handleReady}
                onSendForReview={handleSendForReview}
                jobs={profitabilityInputs.jobs}
                onLinkJob={handleLinkJob}
              />
            )}
            </div>
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <FloatingActionBar
          disabled={deletingRows}
          selectedCount={selectedIds.size}
          eligibleCount={loading || loadError || monthClosed ? 0 : selectedReadyInvoiceRows(feeLines, billingRows, selectedIds, month, focusedJobId, reportStatusMap, supersededSet).length}
          laborCount={loading || loadError || monthClosed ? 0 : selectedLaborFeeRows(feeLines, selectedIds, month, focusedJobId).length}
          monthLabel={month}
          selectedFee={selectedFee}
          onClear={clearSelection}
          onSetFeePct={handleSetFeePctSelected}
          onDelete={handleDeleteSelected}
          onExport={handleExportSelected}
          onMarkBilled={handleMarkBilledSelected}
          coveredCount={loading || loadError || monthClosed ? 0 : coveredRows.length}
          onCovered={handleCoveredSelected}
        />
      )}

      <RecordInvoiceDialog request={billRequest} invoices={invoices} onCancel={() => setBillRequest(null)} onConfirm={confirmBill} />

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
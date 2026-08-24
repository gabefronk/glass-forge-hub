import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { computeFeeAmt, computeLaborAmt, formatMoney, currentMonthStr, isFutureRow } from "@/lib/feeMath";
import InvoicingTopBar from "@/components/invoicing/InvoicingTopBar";
import InvoicingHero from "@/components/invoicing/InvoicingHero";
import InvoicingToolbar from "@/components/invoicing/InvoicingToolbar";
import LineList from "@/components/invoicing/LineList";
import JobsView from "@/components/invoicing/JobsView";
import FloatingActionBar from "@/components/invoicing/FloatingActionBar";

const isReady = (r) => r.billable && !r.billed_to_bfs && !isFutureRow(r) && !(r.needs_review && !r.manually_adjusted) && Number(r.labor_amt) > 0;
const isBlocked = (r) => r.needs_review && !r.manually_adjusted;
const isCustomFee = (r) => r.fee_type !== "profit_split" && Number(r.fee_pct) !== 0.1;

export default function Invoicing() {
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

  const load = async () => {
    setLoading(true);
    try {
      const fl = await base44.entities.FeeLines.filter({ invoice_month: month }, "-job_date", 5000);
      setFeeLines(Array.isArray(fl) ? fl : []);
    } catch (e) {
      console.error("Invoicing load error:", e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [month]);

  const monthRows = useMemo(() => feeLines.filter((r) => r.invoice_month === month), [feeLines, month]);

  const filteredRows = useMemo(() => {
    let rows = monthRows;
    if (filter === "ready") rows = rows.filter(isReady);
    else if (filter === "needs_report") rows = rows.filter(isBlocked);
    else if (filter === "billed") rows = rows.filter((r) => r.billed_to_bfs);
    if (hideZeros) rows = rows.filter((r) => Number(r.labor_amt) !== 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        [r.line_description, r.job_name_raw, r.job_name_norm, r.po_number, r.oe_number, r.note_text]
          .filter(Boolean)
          .some((s) => s.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [monthRows, filter, hideZeros, search]);

  const filterCounts = useMemo(() => ({
    all: monthRows.length,
    ready: monthRows.filter(isReady).length,
    needs_report: monthRows.filter(isBlocked).length,
    billed: monthRows.filter((r) => r.billed_to_bfs).length,
  }), [monthRows]);

  const heroStats = useMemo(() => {
    const ready = monthRows.filter(isReady);
    const blocked = monthRows.filter(isBlocked);
    const billed = monthRows.filter((r) => r.billed_to_bfs);
    const scheduled = monthRows.filter((r) => isFutureRow(r));
    return {
      readyTotal: ready.reduce((s, r) => s + (computeFeeAmt(r) || 0), 0),
      readyCount: ready.length,
      blockedCount: blocked.length,
      customFeeCount: monthRows.filter(isCustomFee).length,
      billedTotal: billed.reduce((s, r) => s + (computeFeeAmt(r) || 0), 0),
      billedCount: billed.length,
      scheduledTotal: scheduled.reduce((s, r) => s + (computeFeeAmt(r) || 0), 0),
      scheduledCount: scheduled.length,
    };
  }, [monthRows]);

  const selectedFee = useMemo(() => {
    return monthRows.filter((r) => selectedIds.has(r.id)).reduce((s, r) => s + (computeFeeAmt(r) || 0), 0);
  }, [monthRows, selectedIds]);

  // ── Undo system ──────────────────────────────────────────────────
  const performAction = useCallback((message, doFn, undoFn) => {
    doFn();
    setUndo({ message, undoFn });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, []);

  const handleUndo = useCallback(() => {
    setUndo((prev) => {
      if (prev?.undoFn) prev.undoFn();
      return null;
    });
    clearTimeout(undoTimer.current);
  }, []);

  // ── Selection ────────────────────────────────────────────────────
  const toggleRow = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClickedIndex.current = filteredRows.findIndex((r) => r.id === id);
  }, [filteredRows]);

  const shiftClickRow = useCallback((id) => {
    const currentIndex = filteredRows.findIndex((r) => r.id === id);
    if (lastClickedIndex.current === null || currentIndex === -1) {
      toggleRow(id);
      return;
    }
    const start = Math.min(lastClickedIndex.current, currentIndex);
    const end = Math.max(lastClickedIndex.current, currentIndex);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (let i = start; i <= end; i++) next.add(filteredRows[i].id);
      return next;
    });
  }, [filteredRows, toggleRow]);

  const toggleDay = useCallback((dayRows) => {
    const allSelected = dayRows.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) dayRows.forEach((r) => next.delete(r.id));
      else dayRows.forEach((r) => next.add(r.id));
      return next;
    });
  }, [selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleSelectAllReady = useCallback(() => {
    setSelectedIds(new Set(monthRows.filter(isReady).map((r) => r.id)));
  }, [monthRows]);

  // ── Edit / delete ────────────────────────────────────────────────
  const handleEdit = useCallback(async (id, patch) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const merged = { ...row, ...patch, manually_adjusted: true };
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
        merged.fee_amt = computeFeeAmt({ ...merged, manually_adjusted: true });
      }
    }
    setFeeLines((prev) => prev.map((r) => (r.id === id ? merged : r)));
    const { id: _id, created_date, updated_date, created_by_id, ...rest } = merged;
    await base44.entities.FeeLines.update(id, rest);
  }, [feeLines]);

  const handleDelete = useCallback((id) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const { id: _id, created_date, updated_date, created_by_id, ...rest } = row;
    setFeeLines((prev) => prev.filter((r) => r.id !== id));
    base44.entities.FeeLines.delete(id);
    performAction("Line deleted", () => {}, async () => {
      const restored = await base44.entities.FeeLines.create(rest);
      setFeeLines((prev) => [...prev, restored]);
    });
  }, [feeLines, performAction]);

  const handleAddReport = useCallback((id) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const prevReview = row.needs_review;
    handleEdit(id, { needs_review: false, manually_adjusted: true });
    setReportAttached((prev) => new Set([...prev, id]));
    performAction("Report attached", () => {}, () => {
      handleEdit(id, { needs_review: prevReview });
      setReportAttached((prev) => { const next = new Set(prev); next.delete(id); return next; });
    });
  }, [feeLines, handleEdit, performAction]);

  const handleMarkBilled = useCallback((id, value = true) => {
    const row = feeLines.find((r) => r.id === id);
    if (!row) return;
    const prev = row.billed_to_bfs;
    handleEdit(id, { billed_to_bfs: value });
    performAction(value ? "Line marked billed" : "Line reopened", () => {}, () => handleEdit(id, { billed_to_bfs: prev }));
  }, [feeLines, handleEdit, performAction]);

  const handleMarkBilledSelected = useCallback(() => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const updates = selected.map((r) => ({ id: r.id, billed_to_bfs: true, manually_adjusted: true }));
    const prevStates = selected.map((r) => ({ id: r.id, billed_to_bfs: r.billed_to_bfs }));
    setFeeLines((prev) => prev.map((r) => { const u = updates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    base44.entities.FeeLines.bulkUpdate(updates);
    performAction(`${selected.length} lines marked billed`, () => {}, () => {
      const restore = prevStates.map((s) => ({ id: s.id, billed_to_bfs: s.billed_to_bfs }));
      setFeeLines((prev) => prev.map((r) => { const u = restore.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      base44.entities.FeeLines.bulkUpdate(restore);
    });
    clearSelection();
  }, [feeLines, selectedIds, performAction, clearSelection]);

  const handleSetFeePctSelected = useCallback((pct) => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const feePct = pct / 100;
    const updates = selected.map((r) => ({ id: r.id, fee_pct: feePct, fee_amt: Math.round((Number(r.labor_amt) || 0) * feePct * 100) / 100, manually_adjusted: true }));
    const prevStates = selected.map((r) => ({ id: r.id, fee_pct: r.fee_pct, fee_amt: r.fee_amt }));
    setFeeLines((prev) => prev.map((r) => { const u = updates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    base44.entities.FeeLines.bulkUpdate(updates);
    performAction(`Fee set to ${pct}%`, () => {}, () => {
      const restore = prevStates.map((s) => ({ id: s.id, fee_pct: s.fee_pct, fee_amt: s.fee_amt }));
      setFeeLines((prev) => prev.map((r) => { const u = restore.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      base44.entities.FeeLines.bulkUpdate(restore);
    });
  }, [feeLines, selectedIds, performAction]);

  const handleDeleteSelected = useCallback(() => {
    const selected = feeLines.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const deletedData = selected.map((r) => { const { id, created_date, updated_date, created_by_id, ...rest } = r; return rest; });
    setFeeLines((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    Promise.all(selected.map((r) => base44.entities.FeeLines.delete(r.id)));
    performAction(`${selected.length} lines deleted`, () => {}, async () => {
      const restored = await base44.entities.FeeLines.bulkCreate(deletedData);
      setFeeLines((prev) => [...prev, ...restored]);
    });
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

  // ── Jobs view handlers ───────────────────────────────────────────
  const handleBillJob = useCallback((job) => {
    const updates = job.lines.map((r) => ({ id: r.id, billed_to_bfs: true, manually_adjusted: true }));
    const prevStates = job.lines.map((r) => ({ id: r.id, billed_to_bfs: r.billed_to_bfs }));
    setFeeLines((prev) => prev.map((r) => { const u = updates.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
    base44.entities.FeeLines.bulkUpdate(updates);
    performAction(`Job "${job.name}" billed`, () => {}, () => {
      const restore = prevStates.map((s) => ({ id: s.id, billed_to_bfs: s.billed_to_bfs }));
      setFeeLines((prev) => prev.map((r) => { const u = restore.find((u) => u.id === r.id); return u ? { ...r, ...u } : r; }));
      base44.entities.FeeLines.bulkUpdate(restore);
    });
  }, [performAction]);

  const handleExportJob = useCallback((job) => {
    const cols = ["job_date", "line_description", "labor_amt", "fee_pct", "fee_amt", "billed_to_bfs"];
    const header = cols.join(",");
    const body = job.lines.map((r) => cols.map((c) => { const v = r[c]; if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `job-${job.name}-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [month]);

  // ── Keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "a") { e.preventDefault(); setSelectedIds(new Set(filteredRows.map((r) => r.id))); return; }
      if (e.key === "Escape") { setSelectedIds(new Set()); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { if (selectedIds.size > 0) handleMarkBilledSelected(); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filteredRows, selectedIds, handleMarkBilledSelected]);

  // ── Empty month state ────────────────────────────────────────────
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const isPast = month < currentMonth;
  const isFutureM = month > currentMonth;
  const showEmptyState = monthRows.length === 0 && (isPast || isFutureM);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: "#050606" }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,.10)", borderTopColor: "#6EE7C0" }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#050606", minHeight: "100vh" }}>
      <InvoicingTopBar
        month={month}
        onMonthChange={setMonth}
        search={search}
        onSearchChange={setSearch}
        readyCount={heroStats.readyCount}
        onSelectAllReady={handleSelectAllReady}
        searchRef={searchRef}
      />

      <div
        className="max-[699px]:px-[18px]"
        style={{ maxWidth: "1180px", margin: "0 auto", padding: "0 40px", paddingBottom: selectedIds.size > 0 ? "120px" : "60px" }}
      >
        {showEmptyState ? (
          <div style={{ padding: "120px 0", textAlign: "center" }}>
            <p style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: "17px", color: "rgba(255,255,255,.5)", marginBottom: "8px" }}>
              {isPast ? "This month is closed." : "No data for this month yet."}
            </p>
            <p style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: "13px", color: "rgba(255,255,255,.34)", marginBottom: "20px" }}>
              {isPast ? "Switch back to the current month to continue working." : "Come back after the first jobs are posted."}
            </p>
            <button
              onClick={() => setMonth(currentMonth)}
              style={{ padding: "10px 20px", borderRadius: "99px", border: "1px solid rgba(255,255,255,.10)", backgroundColor: "transparent", color: "#6EE7C0", fontFamily: "'Inter Tight',sans-serif", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}
            >
              Back to {new Date().toLocaleDateString("en-US", { month: "long" })}
            </button>
          </div>
        ) : (
          <>
            <InvoicingHero
              {...heroStats}
              onFilterBlocked={() => setFilter("needs_report")}
            />
            <InvoicingToolbar
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
            />
            {view === "lines" ? (
              <LineList
                rows={filteredRows}
                sort={sort}
                selectedIds={selectedIds}
                onToggle={toggleRow}
                onShiftClick={shiftClickRow}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddReport={handleAddReport}
                onMarkBilled={handleMarkBilled}
                onOpenJob={() => {}}
                reportAttached={reportAttached}
                onToggleDay={toggleDay}
                onClearFilters={() => { setFilter("all"); setSearch(""); setHideZeros(false); }}
              />
            ) : (
              <JobsView
                rows={filteredRows}
                onBillJob={handleBillJob}
                onExportJob={handleExportJob}
                onOpenJob={() => {}}
              />
            )}
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

      {undo && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            backgroundColor: "#171B1A",
            border: "1px solid rgba(255,255,255,.10)",
            borderRadius: "99px",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            boxShadow: "0 14px 26px -10px rgba(0,0,0,.9)",
          }}
        >
          <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: "13px", color: "rgba(255,255,255,.62)" }}>{undo.message}</span>
          <button
            onClick={handleUndo}
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: ".05em",
              color: "#6EE7C0",
              border: "1px solid rgba(110,231,192,.30)",
              borderRadius: "99px",
              padding: "4px 10px",
              cursor: "pointer",
              backgroundColor: "transparent",
            }}
          >
            UNDO
          </button>
        </div>
      )}
    </div>
  );
}
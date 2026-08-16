import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatMoney, computeProfit } from "@/lib/feeMath";
import { EditableText, EditableSwitch } from "@/components/fees/EditableCell";
import { C, JOB_GRID, CARD_SHADOW, ROW_SHADOW, statusTag, noteTokens } from "@/lib/feeUI";
import CheckBox from "@/components/fees/CheckBox";
import ExpandedDetail from "@/components/fees/ExpandedDetail";
import RowActions from "@/components/fees/RowActions";
import { cn } from "@/lib/utils";

export default function FeeTable({ rows, jobsById, onEdit, onDelete, stickyTop = 0, selectedIds, onToggleRow, onToggleAll }) {
  const groups = useMemo(() => groupByJob(rows, jobsById), [rows, jobsById]);

  const allRowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = allRowIds.length > 0 && allRowIds.every((id) => selectedIds?.has(id));
  const someSelected = allRowIds.some((id) => selectedIds?.has(id));
  const indeterminate = someSelected && !allSelected;

  const handleToggleAll = () => {
    if (allSelected) {
      allRowIds.forEach((id) => { if (selectedIds.has(id)) onToggleRow(id); });
    } else {
      onToggleAll(allRowIds);
    }
  };

  return (
    <section className="px-4 sm:px-8 pt-6 pb-16" style={{ backgroundColor: C.pageBg }}>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-bold" style={{ fontSize: "17px", fontWeight: 700, color: C.accentDark, whiteSpace: "nowrap" }}>
          By Job
        </h2>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <div
          className={cn(JOB_GRID, "sticky z-10 px-4 py-2.5 rounded-lg")}
          style={{
            top: stickyTop,
            backgroundColor: C.headerBg,
            color: C.headerText,
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <div><CheckBox checked={allSelected} indeterminate={indeterminate} onChange={handleToggleAll} /></div>
          <div>Job</div>
          <div>Date</div>
          <div>Line</div>
          <div className="text-right">Labor</div>
          <div className="text-right">Fee %</div>
          <div className="text-right">Fee</div>
          <div className="text-center">Status</div>
        </div>
        <div className="space-y-[22px] mt-4">
          {groups.map((g) => (
            <JobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} selectedIds={selectedIds} onToggleRow={onToggleRow} />
          ))}
          {!groups.length && (
            <div className="px-4 py-10 text-center text-sm" style={{ color: C.text, opacity: 0.5 }}>No fee lines this month.</div>
          )}
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-3">
        {groups.map((g) => (
          <MobileJobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} selectedIds={selectedIds} onToggleRow={onToggleRow} />
        ))}
        {!groups.length && (
          <div className="py-10 text-center text-sm" style={{ color: C.text, opacity: 0.5 }}>No fee lines this month.</div>
        )}
      </div>
    </section>
  );
}

function JobGroup({ group, onEdit, onDelete, selectedIds, onToggleRow }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}`, boxShadow: CARD_SHADOW, backgroundColor: C.card }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(JOB_GRID, "w-full px-4 py-3 items-center text-left transition-colors")}
        style={{
          background: "linear-gradient(to bottom, #edf1ef, #e2e8e4)",
          borderBottom: `1px solid #ccd4cf`,
          boxShadow: `inset 3px 0 0 ${C.accent}`,
        }}
      >
        <div />
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: C.text, opacity: 0.68 }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.text, opacity: 0.68 }} />}
          <span className="font-bold truncate whitespace-nowrap" style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.015em", color: C.accentDark }}>{group.jobName}</span>
          <span className="text-xs whitespace-nowrap" style={{ color: C.text, opacity: 0.68 }}>· {group.lines.length} line{group.lines.length === 1 ? "" : "s"}</span>
        </div>
        <div />
        <div />
        <div className="text-right tabular-nums font-semibold" style={{ color: C.text }}>${formatMoney(group.laborTotal)}</div>
        <div />
        <div className="text-right tabular-nums font-bold whitespace-nowrap" style={{ color: C.accent }}>${formatMoney(group.feeTotal)}</div>
        <div />
      </button>
      {open && (
        <div>
          {group.lines.map((row, i) => (
            <DesktopRow key={row.id} row={row} onEdit={onEdit} onDelete={onDelete} index={i} selected={selectedIds?.has(row.id)} onToggle={() => onToggleRow(row.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DesktopRow({ row, onEdit, onDelete, index, selected, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const isSplit = row.fee_type === "profit_split";
  const isSuppressed = !!row._suppressed;
  const tag = statusTag(row);
  const tokens = noteTokens(row.note_text);

  return (
    <div>
      <div
        className={cn(JOB_GRID, "px-4 py-2.5 items-center cursor-pointer transition-colors")}
        style={{
          backgroundColor: index % 2 === 1 ? C.cardAlt : C.card,
          borderTop: `1px solid ${C.rowBorder}`,
          boxShadow: ROW_SHADOW,
          borderLeft: `3px solid ${expanded ? C.accent : C.border}`,
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div onClick={(e) => e.stopPropagation()}><CheckBox checked={selected} onChange={onToggle} /></div>
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: C.text, opacity: 0.68 }} /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: C.text, opacity: 0.68 }} />}
          <span className="truncate" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>{row.job_name_norm}</span>
        </div>
        <div className="tabular-nums" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>{row.job_date}</div>
        <div className="min-w-0">
          <EditableText value={row.line_description} className="truncate" onCommit={(v) => onEdit(row.id, { line_description: v })} />
          {tokens && <div className="truncate" style={{ fontSize: "13px", color: C.text, opacity: 0.5 }}>{tokens}</div>}
        </div>
        {isSplit ? (
          <>
            <div className="text-right tabular-nums font-medium" style={{ fontSize: "14px", color: C.accent }}>${formatMoney(computeProfit(row))}</div>
            <div className="flex items-center justify-end gap-1">
              <span className="tabular-nums" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>{Math.round((row.split_pct || 0.5) * 100)}%</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-right"><EditableText value={row.labor_amt} type="number" alignRight displayFormat="currency" className="tabular-nums" onCommit={(v) => onEdit(row.id, { labor_amt: v })} /></div>
            <div className="flex items-center justify-end gap-1"><EditableText value={Math.round((row.fee_pct || 0) * 100)} type="number" alignRight className="w-14 tabular-nums" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} /><span style={{ fontSize: "13px", color: C.text, opacity: 0.68 }}>%</span></div>
          </>
        )}
        <div className="text-right tabular-nums font-medium" style={{ fontSize: "14px", color: C.accent }}>${formatMoney(row.fee_amt)}</div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: tag.bg, color: tag.text }}>{tag.label}</span>
          <div className="flex gap-0.5">
            <PayBadge letter="B" active={row.billed_to_bfs} activeBg={C.tagCal.bg} activeText={C.tagCal.text} />
            <PayBadge letter="P" active={row.paid_to_ya} activeBg={C.tagBillable.bg} activeText={C.tagBillable.text} />
            <PayBadge letter="I" active={row.invoiced_to_ya} activeBg={C.tagBillable.bg} activeText={C.tagBillable.text} />
          </div>
        </div>
      </div>
      {expanded && <ExpandedDetail row={row} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  );
}

function PayBadge({ letter, active, activeBg, activeText }) {
  return (
    <span className="text-[9px] font-bold uppercase w-4 h-4 rounded flex items-center justify-center leading-none" style={active ? { backgroundColor: activeBg, color: activeText } : { backgroundColor: C.mutedBg, color: C.mutedText }}>{letter}</span>
  );
}

function groupByJob(rows, jobsById) {
  const map = new Map();
  for (const r of rows) {
    const key = r.job_id || `__unmatched__${r.job_name_norm}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        jobName: r.job_id ? (jobsById[r.job_id]?.canonical_name || r.job_name_norm) : r.job_name_norm,
        lines: [],
        feeTotal: 0,
        laborTotal: 0,
      });
    }
    const g = map.get(key);
    g.lines.push(r);
    if (!r._suppressed) {
      g.feeTotal += Number(r.fee_amt) || 0;
      g.laborTotal += Number(r.labor_amt) || 0;
    }
  }
  return Array.from(map.values());
}

// ── Mobile ────────────────────────────────────────────────────────────────

function MobileJobGroup({ group, onEdit, onDelete, selectedIds, onToggleRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left" style={{ backgroundColor: C.mutedBg }}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <div className="min-w-0">
          <div className="font-bold truncate uppercase tracking-wide" style={{ fontSize: "14px", color: C.text }}>{group.jobName}</div>
          <div className="text-xs" style={{ color: C.text, opacity: 0.68 }}>{group.lines.length} line{group.lines.length === 1 ? "" : "s"}</div>
        </div>
        <span className="ml-auto font-bold tabular-nums" style={{ fontSize: "14px", color: C.accent }}>${formatMoney(group.feeTotal)}</span>
      </button>
      {open && (
        <div>
          {group.lines.map((row) => (
            <MobileRow key={row.id} row={row} onEdit={onEdit} onDelete={onDelete} selected={selectedIds?.has(row.id)} onToggle={() => onToggleRow(row.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileRow({ row, onEdit, onDelete, selected, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const isSplit = row.fee_type === "profit_split";
  const tag = statusTag(row);
  return (
    <div className="px-4 py-3" style={{ borderTop: `1px solid ${C.rowBorder}`, borderLeft: `3px solid ${expanded ? C.accent : C.border}` }}>
      <div className="flex items-center gap-2">
        <CheckBox checked={selected} onChange={onToggle} />
        <div onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 text-left">
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: "14px", fontWeight: 500, color: C.text }}>{row.line_description || row.job_name_norm}</div>
            <div className="text-xs flex items-center flex-wrap gap-1.5" style={{ color: C.text, opacity: 0.68 }}>
              <span className="tabular-nums">{row.job_date}</span>
              <span>·</span>
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: tag.bg, color: tag.text }}>{tag.label}</span>
              {row.billed_to_bfs && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagCal.bg, color: C.tagCal.text }}>B</span>}
              {row.paid_to_ya && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagBillable.bg, color: C.tagBillable.text }}>P</span>}
              {row.invoiced_to_ya && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagBillable.bg, color: C.tagBillable.text }}>I</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="font-bold tabular-nums" style={{ fontSize: "14px", color: C.accent }}>${formatMoney(row.fee_amt)}</div>
              <div className="text-xs" style={{ color: C.text, opacity: 0.68 }}>{isSplit ? `profit $${formatMoney(computeProfit(row))}` : `labor $${formatMoney(row.labor_amt)}`}</div>
            </div>
            <RowActions row={row} onDelete={onDelete} onEdit={onEdit} />
          </div>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <EditableField label="Line" value={row.line_description} onCommit={(v) => onEdit(row.id, { line_description: v })} />
          <EditableField label="Labor $" value={row.labor_amt} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
          <EditableField label="Fee $" value={row.fee_amt} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { fee_amt: v })} />
          <EditableField label="Fee %" value={Math.round((row.fee_pct || 0) * 100)} type="number" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Billable</span><EditableSwitch checked={row.billable} onCommit={(c) => onEdit(row.id, { billable: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Needs review</span><EditableSwitch checked={row.needs_review} onCommit={(c) => onEdit(row.id, { needs_review: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Billed to BFS</span><EditableSwitch checked={row.billed_to_bfs} onCommit={(c) => onEdit(row.id, { billed_to_bfs: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Paid to YA</span><EditableSwitch checked={row.paid_to_ya} onCommit={(c) => onEdit(row.id, { paid_to_ya: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Invoiced to YA</span><EditableSwitch checked={row.invoiced_to_ya} onCommit={(c) => onEdit(row.id, { invoiced_to_ya: c })} /></div>
          <EditableField label="Paid date" value={row.paid_date} type="date" onCommit={(v) => onEdit(row.id, { paid_date: v })} />
          {row.note_text && (
            <div>
              <div className="mb-1" style={{ fontSize: "11px", textTransform: "uppercase", color: C.text, opacity: 0.68 }}>Note (verbatim)</div>
              <div className="rounded border p-2 text-sm whitespace-pre-wrap" style={{ borderColor: C.border, backgroundColor: C.mutedBg, color: C.text }}>{row.note_text}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <MobDetail label="Man hours" value={row.man_hours ?? "—"} />
            <MobDetail label="Trip charges" value={row.trip_charges ?? "—"} />
            <MobDetail label="Cal event id" value={row.calendar_event_id || "—"} />
            <MobDetail label="PB post id" value={row.probuild_post_id || "—"} />
            <MobDetail label="Cal creator" value={row.calendar_creator || "—"} />
            <MobDetail label="Cal organizer" value={row.calendar_organizer || "—"} />
          </div>
        </div>
      )}
    </div>
  );
}

function EditableField({ label, value, onCommit, type, displayFormat }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-20" style={{ color: C.text, opacity: 0.68 }}>{label}</span>
      <div className="flex-1"><EditableText value={value} type={type} displayFormat={displayFormat} onCommit={onCommit} /></div>
    </div>
  );
}

function MobDetail({ label, value }) {
  return (
    <div>
      <div className="font-semibold" style={{ fontSize: "10px", textTransform: "uppercase", color: C.text, opacity: 0.68 }}>{label}</div>
      <div className="text-sm break-words" style={{ color: C.text }}>{value}</div>
    </div>
  );
}
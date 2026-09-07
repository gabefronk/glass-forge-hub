import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatMoney, computeProfit, computeFeeAmt } from "@/lib/feeMath";
import { EditableText, EditableSwitch } from "@/components/fees/EditableCell";
import { C, statusTag, noteTokens } from "@/lib/feeUI";
import CheckBox from "@/components/fees/CheckBox";
import ExpandedDetail from "@/components/fees/ExpandedDetail";
import RowActions from "@/components/fees/RowActions";

export default function FeeTable({ rows, jobsById, onEdit, onDelete, stickyTop = 0, selectedIds, onToggleRow, onToggleAll }) {
  const groups = useMemo(() => groupByJob(rows, jobsById), [rows, jobsById]);

  return (
    <section className="pt-4">
      <div className="flex items-center gap-2 mb-3 px-1">
        <h2 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>By job</h2>
        <span className="font-mono-num text-[12px]" style={{ color: C.textMuted }}>
          {groups.length} jobs
        </span>
      </div>

      {/* Desktop: right panel job list */}
      <div className="hidden md:block rounded-[16px] overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {groups.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No fee lines this month.</div>
        )}
        {groups.map((g) => (
          <JobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} selectedIds={selectedIds} onToggleRow={onToggleRow} />
        ))}
      </div>

      {/* Mobile: expandable cards */}
      <div className="md:hidden space-y-2">
        {groups.map((g) => (
          <MobileJobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} selectedIds={selectedIds} onToggleRow={onToggleRow} />
        ))}
        {!groups.length && (
          <div className="py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No fee lines this month.</div>
        )}
      </div>
    </section>
  );
}

function JobGroup({ group, onEdit, onDelete, selectedIds, onToggleRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${C.rowBorder}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 text-left transition-colors hover:bg-white/[0.02]"
        style={{ minHeight: "56px" }}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate" style={{ color: C.text }}>{group.jobName}</div>
          <div className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>
            {group.lines.length} lines · ${formatMoney(group.laborTotal)} labor
          </div>
        </div>
        <span className="font-mono-num-bold text-[14px] whitespace-nowrap" style={{ color: C.accent }}>
          ${formatMoney(group.feeTotal)}
        </span>
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
  const tag = statusTag(row);
  const tokens = noteTokens(row.note_text);

  return (
    <div>
      <div
        className="grid grid-cols-[44px_minmax(0,1fr)_90px_90px] gap-2 px-4 py-2 items-center cursor-pointer transition-colors"
        style={{
          minHeight: "52px",
          borderTop: `1px solid ${C.rowBorder}`,
          backgroundColor: expanded ? "rgba(255,255,255,.02)" : "transparent",
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div onClick={(e) => e.stopPropagation()}><CheckBox checked={selected} onChange={onToggle} /></div>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium" style={{ color: C.text }}>{row.line_description || row.job_name_norm}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tokens && <span className="truncate text-[10px]" style={{ color: C.textMuted }}>{tokens}</span>}
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ backgroundColor: tag.bg, color: tag.text }}>{tag.label}</span>
          </div>
        </div>
        <div className="text-right font-mono-num text-[12px]" style={{ color: C.text }}>
          {isSplit ? `$${formatMoney(computeProfit(row))}` : `$${formatMoney(row.labor_amt)}`}
        </div>
        <div className="text-right font-mono-num-bold text-[12px]" style={{ color: C.accent }}>
          ${formatMoney(isSplit ? computeFeeAmt(row) : row.fee_amt)}
        </div>
      </div>
      {expanded && <ExpandedDetail row={row} onEdit={onEdit} onDelete={onDelete} />}
    </div>
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
    <div className="rounded-[14px] overflow-hidden" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 text-left" style={{ minHeight: "56px" }}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: C.textMuted }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.textMuted }} />}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold truncate" style={{ color: C.text }}>{group.jobName}</div>
          <div className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>{group.lines.length} lines</div>
        </div>
        <span className="font-mono-num-bold text-[14px] whitespace-nowrap" style={{ color: C.accent }}>${formatMoney(group.feeTotal)}</span>
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
    <div className="px-4" style={{ borderTop: `1px solid ${C.rowBorder}` }}>
      <div className="flex items-center gap-2" style={{ minHeight: "56px" }}>
        <CheckBox checked={selected} onChange={onToggle} />
        <div onClick={() => setExpanded((e) => !e)} className="min-w-0 flex-1 flex flex-wrap items-center justify-between gap-2 py-3 text-left">
          <div className="min-w-0 basis-full">
            <div className="break-words text-[13px] font-medium" style={{ color: C.text }}>{row.line_description || row.job_name_norm}</div>
            <div className="text-[11px] flex items-center flex-wrap gap-1.5" style={{ color: C.textMuted }}>
              <span className="font-mono-num">{row.job_date}</span>
              <span>·</span>
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: tag.bg, color: tag.text }}>{tag.label}</span>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="text-left">
              <div className="font-mono-num-bold text-[14px]" style={{ color: C.accent }}>${formatMoney(row.fee_amt)}</div>
              <div className="font-mono-num text-[10px]" style={{ color: C.textMuted }}>{isSplit ? `profit $${formatMoney(computeProfit(row))}` : `labor $${formatMoney(row.labor_amt)}`}</div>
            </div>
            <RowActions row={row} onDelete={onDelete} onEdit={onEdit} />
          </div>
        </div>
      </div>
      {expanded && (
        <div className="pb-3 space-y-2 text-sm">
          <EditableField label="Line" value={row.line_description} onCommit={(v) => onEdit(row.id, { line_description: v })} />
          <EditableField label="Labor $" value={row.labor_amt} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
          <EditableField label="Fee $" value={row.fee_amt} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { fee_amt: v })} />
          <EditableField label="Fee %" value={Math.round((row.fee_pct || 0) * 100)} type="number" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
          {isSplit && <>
            <EditableField label="Sale $" value={row.sale_price} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { sale_price: v })} />
            <EditableField label="Cost $" value={row.cost} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { cost: v })} />
            <EditableField label="Split %" value={Math.round((row.split_pct ?? 0.5) * 100)} type="number" onCommit={(v) => onEdit(row.id, { split_pct: v == null || v === "" ? null : Number(v) / 100 })} />
          </>}
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.textMuted }}>Billable</span><EditableSwitch checked={row.billable} onCommit={(c) => onEdit(row.id, { billable: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.textMuted }}>Needs review</span><EditableSwitch checked={row.needs_review} onCommit={(c) => onEdit(row.id, { needs_review: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.textMuted }}>Billed to BFS</span><EditableSwitch checked={row.billed_to_bfs} onCommit={(c) => onEdit(row.id, { billed_to_bfs: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.textMuted }}>Paid to YA</span><EditableSwitch checked={row.paid_to_ya} onCommit={(c) => onEdit(row.id, { paid_to_ya: c })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs" style={{ color: C.textMuted }}>Invoiced to YA</span><EditableSwitch checked={row.invoiced_to_ya} onCommit={(c) => onEdit(row.id, { invoiced_to_ya: c })} /></div>
          <EditableField label="Paid date" value={row.paid_date} type="date" onCommit={(v) => onEdit(row.id, { paid_date: v })} />
          {row.note_text && (
            <div>
              <div className="mono-label-sm mb-1">Note (verbatim)</div>
              <div className="rounded p-2 text-sm whitespace-pre-wrap break-words" style={{ border: `1px solid ${C.border}`, backgroundColor: C.mutedBg, color: C.text }}>{row.note_text}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditableField({ label, value, onCommit, type = "text", displayFormat = undefined }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-20 shrink-0" style={{ color: C.textMuted }}>{label}</span>
      <div className="min-w-0 flex-1"><EditableText value={value} type={type} displayFormat={displayFormat} onCommit={onCommit} /></div>
    </div>
  );
}

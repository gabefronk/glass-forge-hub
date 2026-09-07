import { useState } from "react";
import { Trash2 } from "lucide-react";
import { feeMathString, computeFeeAmt, formatMoney } from "@/lib/feeMath";
import { EditableText } from "@/components/fees/EditableCell";
import { C } from "@/lib/feeUI";

export default function ExpandedDetail({ row, onEdit, onDelete }) {
  const isSplit = row.fee_type === "profit_split";
  const sourceLabel = {
    calendar: "calendar labor",
    probuild: "probuild",
    "sheet-import": "sheet import",
    both: "calendar + probuild",
    app: "manual entry",
  }[row.source] || row.source;

  return (
    <div
      className="min-w-0 px-4 pb-5 pt-4 border-t"
      style={{ backgroundColor: C.cardAlt, borderColor: C.border }}
    >
      <div className="grid min-w-0 grid-cols-1 gap-6">
        {/* LEFT */}
        <div className="min-w-0 space-y-4">
          <FeeMathDisplay row={row} />
          <div className="text-xs" style={{ color: C.textSecondary }}>Source: {sourceLabel}</div>

          {isSplit ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))" }}>
              <FieldCard label="Sale"><EditableText value={row.sale_price} type="number" displayFormat="currency" className="text-base font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { sale_price: v })} /></FieldCard>
              <FieldCard label="Cost"><EditableText value={row.cost} type="number" displayFormat="currency" className="text-base font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { cost: v })} /></FieldCard>
              <FieldCard label="Split %"><div className="flex items-baseline gap-1"><EditableText value={Math.round((row.split_pct || 0.5) * 100)} type="number" className="text-base font-bold tabular-nums w-10 px-0 py-0" onCommit={(v) => onEdit(row.id, { split_pct: v == null || v === "" ? null : Number(v) / 100 })} /><span className="text-base font-bold" style={{ color: C.textSecondary }}>%</span></div></FieldCard>
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))" }}>
              <FieldCard label="Labor"><EditableText value={row.labor_amt} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { labor_amt: v })} /></FieldCard>
              <FieldCard label="Fee"><EditableText value={row.fee_amt} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { fee_amt: v })} /></FieldCard>
              <FieldCard label="Fee %"><div className="flex items-baseline gap-1"><EditableText value={Math.round((row.fee_pct || 0) * 100)} type="number" className="text-xl font-bold tabular-nums w-12 px-0 py-0" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} /><span className="text-xl font-bold" style={{ color: C.textSecondary }}>%</span></div></FieldCard>
            </div>
          )}

          <div>
            <div className="font-semibold mb-1.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>Workflow</div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge label="Billable" active={row.billable} onClick={() => onEdit(row.id, { billable: !row.billable })} />
              <StatusBadge label="Needs review" active={row.needs_review} onClick={() => onEdit(row.id, { needs_review: !row.needs_review })} />
              <StatusBadge label="Billed to BFS" active={row.billed_to_bfs} onClick={() => onEdit(row.id, { billed_to_bfs: !row.billed_to_bfs })} />
              <StatusBadge label="Paid to YA" active={row.paid_to_ya} onClick={() => onEdit(row.id, { paid_to_ya: !row.paid_to_ya })} />
              <StatusBadge label="Invoiced to YA" active={row.invoiced_to_ya} onClick={() => onEdit(row.id, { invoiced_to_ya: !row.invoiced_to_ya })} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold whitespace-nowrap" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>Paid date</span>
            <EditableText value={row.paid_date} type="date" onCommit={(v) => onEdit(row.id, { paid_date: v })} />
            {!row.paid_date && <span className="text-xs italic" style={{ color: C.text, opacity: 0.5 }}>not set</span>}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t" style={{ borderColor: C.border }}>
            <Detail label="Man hours" value={row.man_hours ?? "—"} />
            <Detail label="Trip charges" value={row.trip_charges ?? "—"} />
            <Detail label="Cal creator" value={row.calendar_creator || "—"} />
            <Detail label="Cal organizer" value={row.calendar_organizer || "—"} />
            <div className="min-w-0">
              <div className="font-semibold mb-0.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>Calendar event</div>
              <div className="inline-block max-w-full font-mono text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: C.mutedBg, border: `1px solid ${C.border}` }}>{row.calendar_event_id || "—"}</div>
              {row.calendar_event_id && <div className="mt-1"><CopyButton text={row.calendar_event_id} label="Copy ID" /></div>}
            </div>
            <Detail label="Probuild post" value={row.probuild_post_id || "—"} />
          </div>

          {onDelete && (
            <div className="pt-3 border-t" style={{ borderColor: C.border }}>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap px-3 py-1.5 rounded-md transition-colors"
                style={{ backgroundColor: C.tagNoCharge.bg, color: C.tagNoCharge.text }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete line
              </button>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="min-w-0 space-y-4">
          {row.note_text && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-semibold" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>Note (verbatim)</div>
                <CopyButton text={row.note_text} label="Copy" />
              </div>
              <div className="rounded-[10px] p-4 whitespace-pre-wrap break-words font-mono" style={{ borderColor: C.border, backgroundColor: C.mutedBg, fontSize: "12.5px", lineHeight: "1.85", color: C.textSecondary }}>
                {row.note_text}
              </div>
            </div>
          )}
          {row.photo_urls && row.photo_urls.length > 0 && (
            <div>
              <div className="font-semibold mb-1.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>Photos</div>
              <div className="flex flex-wrap gap-2">
                {row.photo_urls.map((url, i) => (
                  <img key={i} src={url} alt={`photo ${i + 1}`} className="h-14 w-14 rounded object-cover" style={{ border: `1px solid ${C.border}` }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeeMathDisplay({ row }) {
  const isSplit = row.fee_type === "profit_split";
  const fee = computeFeeAmt(row);

  if (isSplit) {
    const sale = Number(row.sale_price) || 0;
    const cost = Number(row.cost) || 0;
    const profit = sale - cost;
    const split = row.split_pct != null ? Number(row.split_pct) : 0.5;
    return (
      <div>
        <div className="font-semibold mb-2" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>Fee Math</div>
        <div className="font-mono space-y-1.5" style={{ fontSize: "13px" }}>
          <div className="flex items-center justify-between gap-2">
            <span style={{ color: C.textSecondary }}>Sale</span>
            <span className="tabular-nums" style={{ color: C.text }}>${formatMoney(sale)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span style={{ color: C.textSecondary }}>Cost</span>
            <span className="tabular-nums" style={{ color: C.text }}>−${formatMoney(cost)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1.5" style={{ borderTop: `1px solid ${C.border}` }}>
            <span style={{ color: C.textSecondary }}>Profit</span>
            <span className="tabular-nums" style={{ color: C.text }}>${formatMoney(profit)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span style={{ color: C.textSecondary }}>Split</span>
            <span className="tabular-nums" style={{ color: C.text }}>{Math.round(split * 100)}%</span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 mt-1" style={{ borderTop: `1px solid ${C.border}` }}>
            <span className="font-semibold" style={{ color: C.textSecondary }}>Fee</span>
            <span className="font-bold tabular-nums" style={{ fontSize: "18px", color: C.accent }}>${formatMoney(fee)}</span>
          </div>
        </div>
      </div>
    );
  }

  const formula = feeMathString(row);
  const idx = formula.lastIndexOf(" = ");
  const lhs = idx >= 0 ? formula.slice(0, idx) : formula;
  const result = idx >= 0 ? formula.slice(idx + 3) : "";
  return (
    <div>
      <div className="font-semibold mb-1" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>Fee Math</div>
      <div className="font-mono" style={{ fontSize: "13px", color: C.textSecondary, lineHeight: "1.6" }}>
        {lhs} = <span className="font-bold tabular-nums" style={{ fontSize: "18px", color: C.accent }}>{result}</span>
      </div>
    </div>
  );
}

function StatusBadge({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors"
      style={active ? { borderColor: C.accent, backgroundColor: C.accent18, color: C.accentText } : { borderColor: C.border, backgroundColor: C.mutedBg, color: C.textSecondary }}
    >
      <span className="h-2 w-2 rounded-full" style={active ? { backgroundColor: C.accent } : { border: `1.5px solid ${C.mutedText}` }} />
      {label}
    </button>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs transition-colors whitespace-nowrap"
      style={{ color: copied ? C.accent : C.text, opacity: 0.68 }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function FieldCard({ label, children }) {
  return (
    <div className="min-w-0 rounded-[10px] px-3 py-2" style={{ backgroundColor: C.mutedBg, border: `1px solid ${C.border}` }}>
      <div className="font-semibold mb-0.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>{label}</div>
      {children}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold mb-0.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.textSecondary }}>{label}</div>
      <div className="text-sm break-words" style={{ color: C.text }}>{value}</div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import RowActions from "@/components/fees/RowActions";
import { Button } from "@/components/ui/button";
import { feeMathString, formatMoney, computeProfit } from "@/lib/feeMath";
import { EditableText, EditableSwitch } from "@/components/fees/EditableCell";
import { cn } from "@/lib/utils";

// ── Palette ──────────────────────────────────────────────────────────────
const C = {
  pageBg: "#f3f3f1",
  card: "#fbfbfa",
  cardAlt: "#fdfdfc",
  text: "#1b1c22",
  accent: "#1f5049",
  accentDark: "#12211e",
  accentText: "#143a34",
  border: "#e2e2de",
  rowBorder: "#ebebe7",
  headerBg: "#12211e",
  headerText: "#cfdcd7",
  tagBillable: { bg: "#dbe7e3", text: "#143a34" },
  tagCal: { bg: "#e3eaf2", text: "#2c4a63" },
  tagReview: { bg: "#f5e6cd", text: "#6b4a12" },
  tagSplit: { bg: "#fef3c7", text: "#6b4a12" },
  accent18: "#d7dfde", // 18% accent tint over white
  mutedBg: "#f0f0ee",
  mutedText: "#c4c4c0",
};

const GABE_EMAIL = "gabriel.fronk.wd@gmail.com";
const ISRAEL_EMAIL = "iryedra@gmail.com";

function billingTier(row) {
  if (row.calendar_creator === GABE_EMAIL) return "gabe";
  if (row.calendar_creator === ISRAEL_EMAIL && row.calendar_organizer === ISRAEL_EMAIL) return "mine";
  return null;
}

const SERVICE_RE = /service|warranty|wty|warr|per report/i;
const INSTALL_RE = /install/i;

function workType(row) {
  const labor = Number(row.labor_amt) || 0;
  const text = `${row.job_name_raw || ""} ${row.note_text || ""}`;
  const isService = SERVICE_RE.test(text);
  const isInstall = INSTALL_RE.test(text);
  if (isInstall && !isService) return "install";
  if (isService) return "service";
  if (labor > 0) return "service";
  return "zero";
}

function noteTokens(noteText) {
  if (!noteText) return "";
  return noteText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^labor\s*\$/i.test(l))
    .join(" · ");
}

// Grid template — fluid minmax so nothing clips down to ~800px
const ROW_GRID =
  "grid grid-cols-[minmax(190px,1.6fr)_68px_minmax(130px,1.4fr)_96px_52px_minmax(48px,0.5fr)_minmax(52px,0.5fr)_minmax(108px,116px)] gap-3";

const CARD_SHADOW =
  "0 1px 1px rgba(18,33,30,0.06), 0 10px 24px -12px rgba(18,33,30,0.28), 0 26px 48px -28px rgba(18,33,30,0.22)";

const ROW_SHADOW = "inset 0 1px 0 #ffffff, 0 1px 0 rgba(18,33,30,0.04)";

export default function FeeTable({ rows, jobsById, onEdit, onDelete, stickyTop = 0, onAddSplit, splitForm, onBulkSet }) {
  const groups = useMemo(() => groupByJob(rows, jobsById), [rows, jobsById]);

  return (
    <section className="px-4 sm:px-8 pt-6 pb-16" style={{ backgroundColor: C.pageBg }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading text-xs font-bold uppercase tracking-widest" style={{ color: C.text }}>
          By Job
        </h2>
        {onAddSplit && (
          <Button size="sm" variant="outline" onClick={onAddSplit}>
            <Plus className="h-4 w-4 mr-1" /> Add profit-split job
          </Button>
        )}
      </div>
      {splitForm}
      {onBulkSet && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: C.text, opacity: 0.68 }}>
            Bulk set (visible):
          </span>
          <Button size="sm" variant="outline" onClick={() => onBulkSet("billed_to_bfs", true)}>Mark all billed</Button>
          <Button size="sm" variant="outline" onClick={() => onBulkSet("paid_to_ya", true)}>Mark all paid</Button>
          <Button size="sm" variant="outline" onClick={() => onBulkSet("invoiced_to_ya", true)}>Mark all invoiced</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs" style={{ color: C.text, opacity: 0.68 }}>
        <Legend swatch={C.tagBillable.bg} border={C.accent} label="Billable" />
        <Legend swatch={C.tagCal.bg} border={C.tagCal.text} label="Cal / Billed" />
        <Legend swatch={C.tagReview.bg} border={C.tagReview.text} label="Needs review" />
        <Legend swatch={C.tagSplit.bg} border="#f59e0b" label="Profit Split" />
        <Legend swatch={C.tagCal.bg} border={C.tagCal.text} label="Gabe" />
        <Legend swatch={C.tagBillable.bg} border={C.accent} label="Mine" />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <div
          className={cn(ROW_GRID, "sticky z-10 px-4 py-3 rounded-lg")}
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
          <div>Job</div>
          <div>Date</div>
          <div>Line</div>
          <div className="text-right">Labor $</div>
          <div className="text-right">Fee %</div>
          <div className="text-center">Source</div>
          <div className="text-center">Pay</div>
          <div className="text-center">Flags</div>
        </div>
        <div className="space-y-[22px] mt-4">
          {groups.map((g) => (
            <JobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} />
          ))}
          {!groups.length && (
            <div className="px-4 py-10 text-center text-sm" style={{ color: C.text, opacity: 0.5 }}>
              No fee lines this month.
            </div>
          )}
        </div>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {groups.map((g) => (
          <MobileJobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} />
        ))}
        {!groups.length && (
          <div className="py-10 text-center text-sm" style={{ color: C.text, opacity: 0.5 }}>
            No fee lines this month.
          </div>
        )}
      </div>
    </section>
  );
}

function JobGroup({ group, onEdit, onDelete }) {
  const [open, setOpen] = useState(true);
  const jobName = group.jobName;
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${C.border}`,
        boxShadow: CARD_SHADOW,
        backgroundColor: C.card,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(ROW_GRID, "w-full px-4 py-3 items-center text-left transition-colors")}
        style={{
          background: "linear-gradient(to bottom, #edf1ef, #e2e8e4)",
          borderBottom: `1px solid #ccd4cf`,
          boxShadow: `inset 3px 0 0 ${C.accent}`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: C.text, opacity: 0.68 }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.text, opacity: 0.68 }} />}
          <span className="font-bold truncate whitespace-nowrap" style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.015em", color: "#12211e" }}>
            {jobName}
          </span>
          <span className="text-xs whitespace-nowrap" style={{ color: C.text, opacity: 0.68 }}>· {group.lines.length} line{group.lines.length === 1 ? "" : "s"}</span>
        </div>
        <div />
        <div />
        <div className="text-right tabular-nums font-semibold" style={{ color: C.text }}>
          ${formatMoney(group.laborTotal)}
        </div>
        <div />
        <div />
        <div />
        <div className="text-right tabular-nums font-bold whitespace-nowrap" style={{ color: C.accent }}>
          ${formatMoney(group.feeTotal)}
        </div>
      </button>
      {open && (
        <div>
          {group.lines.map((row, i) => (
            <DesktopRow key={row.id} row={row} onEdit={onEdit} onDelete={onDelete} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function DesktopRow({ row, onEdit, onDelete, index }) {
  const [expanded, setExpanded] = useState(false);
  const tier = billingTier(row);
  const wt = workType(row);
  const isSplit = row.fee_type === "profit_split";
  const isSuppressed = !!row._suppressed;
  const tokens = noteTokens(row.note_text);

  return (
    <div>
      <div
        className={cn(ROW_GRID, "px-4 py-2.5 items-center cursor-pointer transition-colors")}
        style={{
          backgroundColor: index % 2 === 1 ? C.cardAlt : C.card,
          borderTop: `1px solid ${C.rowBorder}`,
          boxShadow: ROW_SHADOW,
          borderLeft: `3px solid ${expanded ? C.accent : C.border}`,
          borderRadius: "0 0 0 3px",
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Job */}
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: C.text, opacity: 0.68 }} /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: C.text, opacity: 0.68 }} />}
          <span className="truncate" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>{row.job_name_norm}</span>
        </div>
        {/* Date */}
        <div className="tabular-nums" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>{row.job_date}</div>
        {/* Line */}
        <div className="min-w-0">
          <EditableText value={row.line_description} className="truncate" onCommit={(v) => onEdit(row.id, { line_description: v })} />
          {tokens && (
            <div className="truncate" style={{ fontSize: "13px", color: C.text, opacity: 0.5 }}>
              {tokens}
            </div>
          )}
        </div>
        {isSplit ? (
          <>
            {/* Labor → profit for split */}
            <div className="text-right tabular-nums font-medium" style={{ fontSize: "14px", color: C.accent }}>
              ${formatMoney(computeProfit(row))}
            </div>
            {/* Fee % → split pct */}
            <div className="flex items-center justify-end gap-1">
              <span className="tabular-nums" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>{Math.round((row.split_pct || 0.5) * 100)}%</span>
            </div>
          </>
        ) : (
          <>
            {/* Labor $ */}
            <div className="text-right">
              <EditableText value={row.labor_amt} type="number" alignRight displayFormat="currency" className="tabular-nums" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
            </div>
            {/* Fee % */}
            <div className="flex items-center justify-end gap-1">
              <EditableText value={Math.round((row.fee_pct || 0) * 100)} type="number" alignRight className="w-14 tabular-nums" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
              <span style={{ fontSize: "13px", color: C.text, opacity: 0.68 }}>%</span>
            </div>
          </>
        )}
        {/* Source */}
        <div className="text-center"><SourceBadge source={row.source} /></div>
        {/* Pay */}
        <div className="flex items-center justify-center gap-1">
          <PayBadge letter="B" active={row.billed_to_bfs} title="Billed to BFS" activeBg={C.tagCal.bg} activeText={C.tagCal.text} />
          <PayBadge letter="P" active={row.paid_to_ya} title="Paid to YA" activeBg={C.tagBillable.bg} activeText={C.tagBillable.text} />
          <PayBadge letter="I" active={row.invoiced_to_ya} title="Invoiced to YA" activeBg={C.tagBillable.bg} activeText={C.tagBillable.text} />
        </div>
        {/* Flags */}
        <div className="flex items-center justify-center gap-1.5">
          {isSplit && <span title="Profit-split job" className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap" style={{ backgroundColor: C.tagSplit.bg, color: C.tagSplit.text }}>Split</span>}
          {isSuppressed && <span title="Suppressed — labor counted inside profit split" className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap line-through" style={{ backgroundColor: C.mutedBg, color: C.mutedText }}>Supp</span>}
          {tier === "gabe" && <span title="Created by Gabe Fronk — different billing %" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: C.tagCal.text }} />}
          {tier === "mine" && <span title="Manually added by you — different billing %" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: C.accent }} />}
          {row.manually_adjusted && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap" style={{ backgroundColor: C.tagBillable.bg, color: C.tagBillable.text }}>Edit</span>}
          {row.needs_review && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap" style={{ backgroundColor: C.tagReview.bg, color: C.tagReview.text }}>Rev</span>}
          <RowActions row={row} onDelete={onDelete} onEdit={onEdit} />
        </div>
      </div>
      {expanded && <ExpandedDetail row={row} onEdit={onEdit} />}
    </div>
  );
}

// ── Expanded Detail ──────────────────────────────────────────────────────

function FeeMathDisplay({ row }) {
  const formula = feeMathString(row);
  const idx = formula.lastIndexOf(" = ");
  const lhs = idx >= 0 ? formula.slice(0, idx) : formula;
  const result = idx >= 0 ? formula.slice(idx + 3) : "";
  return (
    <div>
      <div className="font-semibold mb-1" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>
        Fee Math
      </div>
      <div className="font-mono" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>
        {lhs} = <span className="font-bold tabular-nums" style={{ fontSize: "20px", color: C.accent }}>{result}</span>
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
      style={
        active
          ? { borderColor: C.accent, backgroundColor: C.accent18, color: C.accentText }
          : { borderColor: C.border, backgroundColor: "#ffffff", color: C.text, opacity: 0.68 }
      }
    >
      <span
        className="h-2 w-2 rounded-full"
        style={active ? { backgroundColor: C.accent } : { border: `1.5px solid ${C.mutedText}` }}
      />
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

function ExpandedDetail({ row, onEdit }) {
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
      className="px-6 pb-5 pt-4 border-t"
      style={{
        background: "linear-gradient(to bottom, #f4f6f4, #f0f2ef)",
        borderColor: C.border,
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT column */}
        <div className="space-y-4">
          <FeeMathDisplay row={row} />
          <div className="text-xs" style={{ color: C.text, opacity: 0.68 }}>
            Source: {sourceLabel}
          </div>

          {/* Editable fields */}
          {isSplit ? (
            <div className="grid grid-cols-3 gap-3">
              <FieldCard label="Sale">
                <EditableText value={row.sale_price} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { sale_price: v })} />
              </FieldCard>
              <FieldCard label="Cost">
                <EditableText value={row.cost} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { cost: v })} />
              </FieldCard>
              <FieldCard label="Split %">
                <div className="flex items-baseline gap-1">
                  <EditableText value={Math.round((row.split_pct || 0.5) * 100)} type="number" className="text-xl font-bold tabular-nums w-12 px-0 py-0" onCommit={(v) => onEdit(row.id, { split_pct: v == null || v === "" ? null : Number(v) / 100 })} />
                  <span className="text-xl font-bold" style={{ color: C.text, opacity: 0.68 }}>%</span>
                </div>
              </FieldCard>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <FieldCard label="Labor">
                <EditableText value={row.labor_amt} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
              </FieldCard>
              <FieldCard label="Fee">
                <EditableText value={row.fee_amt} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { fee_amt: v })} />
              </FieldCard>
              <FieldCard label="Fee %">
                <div className="flex items-baseline gap-1">
                  <EditableText value={Math.round((row.fee_pct || 0) * 100)} type="number" className="text-xl font-bold tabular-nums w-12 px-0 py-0" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
                  <span className="text-xl font-bold" style={{ color: C.text, opacity: 0.68 }}>%</span>
                </div>
              </FieldCard>
            </div>
          )}

          {/* Workflow */}
          <div>
            <div className="font-semibold mb-1.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>
              Workflow
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge label="Billable" active={row.billable} onClick={() => onEdit(row.id, { billable: !row.billable })} />
              <StatusBadge label="Needs review" active={row.needs_review} onClick={() => onEdit(row.id, { needs_review: !row.needs_review })} />
              <StatusBadge label="Billed to BFS" active={row.billed_to_bfs} onClick={() => onEdit(row.id, { billed_to_bfs: !row.billed_to_bfs })} />
              <StatusBadge label="Paid to YA" active={row.paid_to_ya} onClick={() => onEdit(row.id, { paid_to_ya: !row.paid_to_ya })} />
              <StatusBadge label="Invoiced to YA" active={row.invoiced_to_ya} onClick={() => onEdit(row.id, { invoiced_to_ya: !row.invoiced_to_ya })} />
            </div>
          </div>

          {/* Paid date */}
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>Paid date</span>
            <EditableText value={row.paid_date} type="date" onCommit={(v) => onEdit(row.id, { paid_date: v })} />
            {!row.paid_date && <span className="text-xs italic" style={{ color: C.text, opacity: 0.5 }}>not set</span>}
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 pt-3 border-t" style={{ borderColor: C.border }}>
            <Detail label="Man hours" value={row.man_hours ?? "—"} />
            <Detail label="Trip charges" value={row.trip_charges ?? "—"} />
            <Detail label="Cal creator" value={row.calendar_creator || "—"} />
            <Detail label="Cal organizer" value={row.calendar_organizer || "—"} />
            <div>
              <div className="font-semibold mb-0.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>Calendar event</div>
              <div className="inline-block max-w-full font-mono text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: C.mutedBg, border: `1px solid ${C.border}` }}>
                {row.calendar_event_id || "—"}
              </div>
              {row.calendar_event_id && <div className="mt-1"><CopyButton text={row.calendar_event_id} label="Copy ID" /></div>}
            </div>
            <Detail label="Probuild post" value={row.probuild_post_id || "—"} />
          </div>
        </div>

        {/* RIGHT column */}
        <div className="space-y-4">
          {row.note_text && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-semibold" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>Note (verbatim)</div>
                <CopyButton text={row.note_text} label="Copy" />
              </div>
              <div
                className="rounded-lg border p-4 whitespace-pre-wrap font-mono"
                style={{
                  borderColor: C.border,
                  backgroundColor: "#f4f6f4",
                  fontSize: "12.5px",
                  lineHeight: "1.85",
                  color: C.text,
                }}
              >
                {row.note_text}
              </div>
            </div>
          )}
          {row.photo_urls && row.photo_urls.length > 0 && (
            <div>
              <div className="font-semibold mb-1.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>Photos</div>
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

function FieldCard({ label, children }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: "#ffffff", border: `1px solid ${C.border}` }}>
      <div className="font-semibold mb-0.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>{label}</div>
      {children}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="font-semibold mb-0.5" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>{label}</div>
      <div className="text-sm break-words" style={{ color: C.text }}>{value}</div>
    </div>
  );
}

function Legend({ swatch, border, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: swatch, border: `1px solid ${border}` }} />
      {label}
    </span>
  );
}

function SourceBadge({ source }) {
  const map = {
    calendar: { label: "Cal", bg: C.tagCal.bg, text: C.tagCal.text },
    probuild: { label: "PB", bg: C.mutedBg, text: C.text },
    both: { label: "Both", bg: C.mutedBg, text: C.text },
    "sheet-import": { label: "Sheet", bg: C.tagReview.bg, text: C.tagReview.text },
  };
  const m = map[source] || map.calendar;
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: m.bg, color: m.text, opacity: m.text === C.text ? 0.68 : 1 }}>
      {m.label}
    </span>
  );
}

// ── Mobile ────────────────────────────────────────────────────────────────

function MobileJobGroup({ group, onEdit, onDelete }) {
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
            <MobileRow key={row.id} row={row} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileRow({ row, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const tier = billingTier(row);
  const wt = workType(row);
  const isSplit = row.fee_type === "profit_split";
  const isSuppressed = !!row._suppressed;
  return (
    <div className="px-4 py-3" style={{ borderTop: `1px solid ${C.rowBorder}`, borderLeft: `3px solid ${expanded ? C.accent : C.border}` }}>
      <div onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: "14px", fontWeight: 500, color: C.text }}>{row.line_description || row.job_name_norm}</div>
          <div className="text-xs flex items-center flex-wrap gap-1.5" style={{ color: C.text, opacity: 0.68 }}>
            <span className="tabular-nums">{row.job_date}</span>
            <span>·</span>
            <SourceBadge source={row.source} />
            {isSplit && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagSplit.bg, color: C.tagSplit.text }}>Split</span>}
            {isSuppressed && <span className="px-1 py-0.5 rounded text-[10px] font-medium line-through" style={{ backgroundColor: C.mutedBg, color: C.mutedText }}>Supp</span>}
            {row.billed_to_bfs && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagCal.bg, color: C.tagCal.text }}>B</span>}
            {row.paid_to_ya && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagBillable.bg, color: C.tagBillable.text }}>P</span>}
            {row.invoiced_to_ya && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagBillable.bg, color: C.tagBillable.text }}>I</span>}
            {tier === "gabe" && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagCal.bg, color: C.tagCal.text }}>Gabe</span>}
            {tier === "mine" && <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: C.tagBillable.bg, color: C.tagBillable.text }}>Manual</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-bold tabular-nums" style={{ fontSize: "14px", color: C.accent }}>${formatMoney(row.fee_amt)}</div>
            <div className="text-xs" style={{ color: C.text, opacity: 0.68 }}>
              {isSplit ? `profit $${formatMoney(computeProfit(row))}` : `labor $${formatMoney(row.labor_amt)}`}
            </div>
          </div>
          <RowActions row={row} onDelete={onDelete} onEdit={onEdit} />
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <EditableField label="Line" value={row.line_description} onCommit={(v) => onEdit(row.id, { line_description: v })} />
          <EditableField label="Labor $" value={row.labor_amt} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
          <EditableField label="Fee $" value={row.fee_amt} type="number" displayFormat="currency" onCommit={(v) => onEdit(row.id, { fee_amt: v })} />
          <EditableField label="Fee %" value={Math.round((row.fee_pct || 0) * 100)} type="number" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Billable</span>
            <EditableSwitch checked={row.billable} onCommit={(c) => onEdit(row.id, { billable: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Needs review</span>
            <EditableSwitch checked={row.needs_review} onCommit={(c) => onEdit(row.id, { needs_review: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Billed to BFS</span>
            <EditableSwitch checked={row.billed_to_bfs} onCommit={(c) => onEdit(row.id, { billed_to_bfs: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Paid to YA</span>
            <EditableSwitch checked={row.paid_to_ya} onCommit={(c) => onEdit(row.id, { paid_to_ya: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>Invoiced to YA</span>
            <EditableSwitch checked={row.invoiced_to_ya} onCommit={(c) => onEdit(row.id, { invoiced_to_ya: c })} />
          </div>
          <EditableField label="Paid date" value={row.paid_date} type="date" onCommit={(v) => onEdit(row.id, { paid_date: v })} />
          <Detail label="Fee math" value={feeMathString(row)} />
          {row.note_text && (
            <div>
              <div className="mb-1" style={{ fontSize: "11px", textTransform: "uppercase", color: C.text, opacity: 0.68 }}>Note (verbatim)</div>
              <div className="rounded border p-2 text-sm whitespace-pre-wrap" style={{ borderColor: C.border, backgroundColor: C.mutedBg, color: C.text }}>{row.note_text}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Detail label="Man hours" value={row.man_hours ?? "—"} />
            <Detail label="Trip charges" value={row.trip_charges ?? "—"} />
            <Detail label="Cal event id" value={row.calendar_event_id || "—"} />
            <Detail label="PB post id" value={row.probuild_post_id || "—"} />
            <Detail label="Cal creator" value={row.calendar_creator || "—"} />
            <Detail label="Cal organizer" value={row.calendar_organizer || "—"} />
          </div>
          {row.photo_urls && row.photo_urls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {row.photo_urls.map((url, i) => (
                <img key={i} src={url} alt={`photo ${i + 1}`} className="h-12 w-12 rounded object-cover" style={{ border: `1px solid ${C.border}` }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditableField({ label, value, onCommit, type, displayFormat }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-20" style={{ color: C.text, opacity: 0.68 }}>{label}</span>
      <div className="flex-1">
        <EditableText value={value} type={type} displayFormat={displayFormat} onCommit={onCommit} />
      </div>
    </div>
  );
}

function PayBadge({ letter, active, title, activeBg, activeText }) {
  return (
    <span
      title={title}
      className="text-[9px] font-bold uppercase w-4 h-4 rounded flex items-center justify-center leading-none"
      style={active ? { backgroundColor: activeBg, color: activeText } : { backgroundColor: C.mutedBg, color: C.mutedText }}
    >
      {letter}
    </span>
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
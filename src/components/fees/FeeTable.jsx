import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Calendar, HardDrive, Layers, Plus } from "lucide-react";
import RowActions from "@/components/fees/RowActions";
import { Button } from "@/components/ui/button";
import { feeMathString, formatMoney, computeProfit } from "@/lib/feeMath";
import { EditableText, EditableSwitch, AdjustedMarker } from "@/components/fees/EditableCell";
import { cn } from "@/lib/utils";

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

function wtBg(wt, row, index = 0) {
  if (wt === "zero") return "bg-[#f1f3f5]";
  if (wt === "install") return "bg-[#dffcf5]";
  if (wt === "service") return "bg-[#fce4ec]";
  if (row.needs_review) return "bg-[#fff5e6]";
  return index % 2 === 1 ? "bg-[#f9f9f9]" : "";
}

function leftBorder(tier, wt) {
  if (tier === "gabe") return "border-l-blue-500";
  if (tier === "mine") return "border-l-violet-500";
  if (wt === "zero") return "border-l-[#E0E0E0]";
  if (wt === "install") return "border-l-[#A1E9E6]";
  if (wt === "service") return "border-l-[#F4C7D0]";
  return "border-l-transparent";
}

export default function FeeTable({ rows, jobsById, onEdit, onDelete, stickyTop = 0, onAddSplit, splitForm, onBulkSet }) {
  const groups = useMemo(() => groupByJob(rows, jobsById), [rows, jobsById]);

  return (
    <section className="px-4 sm:px-8 pt-6 pb-16">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground">
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
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Bulk set (visible):</span>
          <Button size="sm" variant="outline" onClick={() => onBulkSet('billed_to_bfs', true)}>Mark all billed</Button>
          <Button size="sm" variant="outline" onClick={() => onBulkSet('paid_to_ya', true)}>Mark all paid</Button>
          <Button size="sm" variant="outline" onClick={() => onBulkSet('invoiced_to_ya', true)}>Mark all invoiced</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-muted-foreground">
        <Legend swatch="bg-[#f1f3f5] border-[#E0E0E0]" label="Zero $" />
        <Legend swatch="bg-[#dffcf5] border-[#A1E9E6]" label="Install labor" />
        <Legend swatch="bg-[#fce4ec] border-[#F4C7D0]" label="Service labor" />
        <Legend swatch="bg-[#fef3c7] border-[#f59e0b]" label="Profit Split" />
        <Legend swatch="bg-blue-100 border-blue-500" label="Gabe" />
        <Legend swatch="bg-violet-100 border-violet-500" label="Mine" />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <div
          className="sticky z-10 grid grid-cols-[1.6fr_0.8fr_1.4fr_0.8fr_0.8fr_0.5fr_0.5fr_0.5fr] gap-2 px-4 py-3 bg-primary text-primary-foreground text-[11px] uppercase tracking-wide font-semibold rounded-t-lg border border-b-0 border-border"
          style={{ top: stickyTop }}
        >
          <div>Job</div>
          <div>Date</div>
          <div>Line</div>
          <div className="text-right">Labor $</div>
          <div className="text-right">Fee %</div>
          <div>Source</div>
          <div className="text-center">Pay</div>
          <div className="text-center">Flags</div>
        </div>
        <div className="divide-y divide-border border border-t-0 border-border rounded-b-lg overflow-hidden">
          {groups.map((g) => (
            <JobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} />
          ))}
          {!groups.length && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No fee lines this month.</div>
          )}
        </div>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {groups.map((g) => (
          <MobileJobGroup key={g.key} group={g} onEdit={onEdit} onDelete={onDelete} />
        ))}
        {!groups.length && (
          <div className="py-10 text-center text-sm text-muted-foreground">No fee lines this month.</div>
        )}
      </div>
    </section>
  );
}

function JobGroup({ group, onEdit, onDelete }) {
  const [open, setOpen] = useState(true);
  const jobName = group.jobName;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-2 px-4 py-3 text-left transition-colors",
          open ? "bg-[#dffcf5]" : "bg-[#f9f9f9] hover:bg-[#f1f3f5]"
        )}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="font-bold text-sm text-foreground uppercase tracking-wide">{jobName}</span>
        <span className="text-xs text-muted-foreground">· {group.lines.length} line{group.lines.length === 1 ? "" : "s"}</span>
        <span className="ml-auto text-sm font-bold tabular-nums text-accent">${formatMoney(group.feeTotal)}</span>
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
  const isSplit = row.fee_type === 'profit_split';
  const isSuppressed = !!row._suppressed;
  return (
    <div>
      <div
        className={cn(
          "grid grid-cols-[1.6fr_0.8fr_1.4fr_0.8fr_0.8fr_0.5fr_0.5fr_0.5fr] gap-2 px-4 py-2.5 items-center cursor-pointer hover:bg-black/[0.02] border-l-4 transition-colors",
          isSplit ? "bg-[#fef3c7]" : wtBg(wt, row, index),
          isSuppressed && "opacity-50",
          isSplit ? "border-l-[#f59e0b]" : leftBorder(tier, wt)
        )}
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="truncate text-sm text-muted-foreground">{row.job_name_norm}</span>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">{row.job_date}</div>
        <div>
          <EditableText value={row.line_description} onCommit={(v) => onEdit(row.id, { line_description: v })} />
        </div>
        {isSplit ? (
          <>
            <div className="text-right text-sm font-medium tabular-nums text-accent">${formatMoney(computeProfit(row))}</div>
            <div className="flex items-center justify-end gap-1">
              <span className="text-xs text-muted-foreground tabular-nums">{Math.round((row.split_pct || 0.5) * 100)}%</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-right">
              <EditableText value={row.labor_amt} type="number" alignRight displayFormat="currency" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
            </div>
            <div className="flex items-center justify-end gap-1">
              <EditableText value={Math.round((row.fee_pct || 0) * 100)} type="number" alignRight className="w-14" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </>
        )}
        <div><SourceBadge source={row.source} /></div>
        <div className="flex items-center justify-center gap-1">
          <PayBadge letter="B" active={row.billed_to_bfs} title="Billed to BFS" activeClass="bg-green-600 text-white" />
          <PayBadge letter="P" active={row.paid_to_ya} title="Paid to YA" activeClass="bg-blue-600 text-white" />
          <PayBadge letter="I" active={row.invoiced_to_ya} title="Invoiced to YA" activeClass="bg-violet-600 text-white" />
        </div>
        <div className="flex items-center justify-center gap-1.5">
          {isSplit && <span title="Profit-split job" className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[#fef3c7] text-foreground leading-none">Split</span>}
          {isSuppressed && <span title="Suppressed — labor counted inside profit split" className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground leading-none line-through">Supp</span>}
          {tier === "gabe" && <span title="Created by Gabe Fronk — different billing %" className="h-2.5 w-2.5 rounded-full bg-blue-600" />}
          {tier === "mine" && <span title="Manually added by you — different billing %" className="h-2.5 w-2.5 rounded-full bg-violet-600" />}
          {row.manually_adjusted && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground leading-none">Edit</span>}
          {row.needs_review && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground leading-none">Rev</span>}
          <RowActions row={row} onDelete={onDelete} onEdit={onEdit} />
        </div>
      </div>
      {expanded && <ExpandedDetail row={row} onEdit={onEdit} />}
    </div>
  );
}

function FeeMathDisplay({ row }) {
  const formula = feeMathString(row);
  const idx = formula.lastIndexOf(" = ");
  const lhs = idx >= 0 ? formula.slice(0, idx) : formula;
  const result = idx >= 0 ? formula.slice(idx + 3) : "";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Fee Math</div>
      <div className="text-sm text-muted-foreground">
        {lhs} = <span className="text-base font-bold text-[#006030]">{result}</span>
      </div>
    </div>
  );
}

function StatusBadge({ label, active, onClick, activeClass }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
        active ? cn(activeClass, "text-white border-transparent") : "bg-white text-muted-foreground border-border hover:bg-muted"
      )}
    >
      {label}
    </button>
  );
}

function ExpandedDetail({ row, onEdit }) {
  const wt = workType(row);
  const tier = billingTier(row);
  const isSplit = row.fee_type === 'profit_split';
  const sourceLabel = {
    calendar: "calendar labor",
    probuild: "probuild",
    "sheet-import": "sheet import",
    both: "calendar + probuild",
    app: "manual entry",
  }[row.source] || row.source;
  const wtLabel = { install: "Install labor", service: "Service labor", zero: "Zero-dollar ticket" }[wt] || "—";

  return (
    <div className="px-6 pb-5 pt-3 bg-[#dffcf5] border-t border-border">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <FeeMathDisplay row={row} />
          <div className="text-xs text-muted-foreground">Source: {sourceLabel} · {wtLabel}</div>

          {/* Editable fields */}
          {isSplit ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-white border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">Sale</div>
                <EditableText value={row.sale_price} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { sale_price: v })} />
              </div>
              <div className="rounded-lg bg-white border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">Cost</div>
                <EditableText value={row.cost} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { cost: v })} />
              </div>
              <div className="rounded-lg bg-white border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">Split %</div>
                <div className="flex items-baseline gap-1">
                  <EditableText value={Math.round((row.split_pct || 0.5) * 100)} type="number" className="text-xl font-bold tabular-nums w-12 px-0 py-0" onCommit={(v) => onEdit(row.id, { split_pct: v == null || v === "" ? null : Number(v) / 100 })} />
                  <span className="text-xl font-bold text-muted-foreground">%</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-white border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">Labor</div>
                <EditableText value={row.labor_amt} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums px-0 py-0" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
              </div>
              <div className="rounded-lg bg-white border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">Fee</div>
                <EditableText value={row.fee_amt} type="number" displayFormat="currency" className="text-xl font-bold tabular-nums text-accent px-0 py-0" onCommit={(v) => onEdit(row.id, { fee_amt: v })} />
              </div>
              <div className="rounded-lg bg-white border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">Fee %</div>
                <div className="flex items-baseline gap-1">
                  <EditableText value={Math.round((row.fee_pct || 0) * 100)} type="number" className="text-xl font-bold tabular-nums w-12 px-0 py-0" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
                  <span className="text-xl font-bold text-muted-foreground">%</span>
                </div>
              </div>
            </div>
          )}

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            {tier === "gabe" && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-900">Gabe Fronk — different billing %</span>}
            {tier === "mine" && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-900">Manually added — different billing %</span>}
            {wt === "zero" && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-[#f1f3f5] text-foreground">Zero-dollar ticket</span>}
            {wt === "install" && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-[#A1E9E6] text-foreground">Install labor</span>}
            {wt === "service" && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-[#F4C7D0] text-foreground">Service labor</span>}
          </div>

          {/* Workflow */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Workflow</div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge label="Billable" active={row.billable} onClick={() => onEdit(row.id, { billable: !row.billable })} activeClass="bg-[#006030]" />
              <StatusBadge label="Needs review" active={row.needs_review} onClick={() => onEdit(row.id, { needs_review: !row.needs_review })} activeClass="bg-amber-500" />
              <StatusBadge label="Billed to BFS" active={row.billed_to_bfs} onClick={() => onEdit(row.id, { billed_to_bfs: !row.billed_to_bfs })} activeClass="bg-green-600" />
              <StatusBadge label="Paid to YA" active={row.paid_to_ya} onClick={() => onEdit(row.id, { paid_to_ya: !row.paid_to_ya })} activeClass="bg-blue-600" />
              <StatusBadge label="Invoiced to YA" active={row.invoiced_to_ya} onClick={() => onEdit(row.id, { invoiced_to_ya: !row.invoiced_to_ya })} activeClass="bg-violet-600" />
            </div>
          </div>

          {/* Paid date */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Paid date</span>
            <EditableText value={row.paid_date} type="date" onCommit={(v) => onEdit(row.id, { paid_date: v })} />
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
            <Detail label="Man hours" value={row.man_hours ?? "—"} />
            <Detail label="Trip charges" value={row.trip_charges ?? "—"} />
            <Detail label="Cal creator" value={row.calendar_creator || "—"} />
            <Detail label="Cal organizer" value={row.calendar_organizer || "—"} />
            <Detail label="Calendar event id" value={row.calendar_event_id || "—"} mono />
            <Detail label="Probuild post id" value={row.probuild_post_id || "—"} />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {row.note_text && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Note (verbatim)</div>
              <div className="rounded-lg bg-[#f5f5f5] border border-border p-4 text-sm whitespace-pre-wrap text-foreground leading-relaxed">{row.note_text}</div>
            </div>
          )}
          {row.photo_urls && row.photo_urls.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Photos</div>
              <div className="flex flex-wrap gap-2">
                {row.photo_urls.map((url, i) => (
                  <img key={i} src={url} alt={`photo ${i + 1}`} className="h-14 w-14 rounded object-cover border border-border" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">{label}</div>
      <div className={cn("text-sm text-foreground", mono ? "font-mono text-xs break-all" : "break-words")}>{value}</div>
    </div>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full border", swatch)} />
      {label}
    </span>
  );
}

function SourceBadge({ source }) {
  const map = {
    calendar: { label: "Cal", cls: "text-muted-foreground italic" },
    probuild: { label: "PB", cls: "text-muted-foreground italic" },
    both: { label: "Both", cls: "text-muted-foreground italic" },
    "sheet-import": { label: "Sheet", cls: "text-amber-700 font-medium" },
  };
  const m = map[source] || map.calendar;
  return (
    <span className={cn("text-xs font-medium", m.cls)}>{m.label}</span>
  );
}

// Mobile
function MobileJobGroup({ group, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 bg-[#f9f9f9] text-left">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <div className="min-w-0">
          <div className="font-bold text-sm truncate uppercase tracking-wide">{group.jobName}</div>
          <div className="text-xs text-muted-foreground">{group.lines.length} line{group.lines.length === 1 ? "" : "s"}</div>
        </div>
        <span className="ml-auto font-bold text-sm tabular-nums text-accent">${formatMoney(group.feeTotal)}</span>
      </button>
      {open && (
        <div className="divide-y divide-border">
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
  return (
    <div className={cn("px-4 py-3 border-l-4", wtBg(wt, row), leftBorder(tier, wt))}>
      <div onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.line_description || row.job_name_norm}</div>
          <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-1.5">
            <span className="tabular-nums">{row.job_date}</span>
            <span>·</span>
            <SourceBadge source={row.source} />
            {wt === "zero" && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-[#f1f3f5] text-foreground">Zero $</span>}
            {wt === "install" && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-[#A1E9E6] text-foreground">Install</span>}
            {wt === "service" && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-[#F4C7D0] text-foreground">Service</span>}
            {row.fee_type === 'profit_split' && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-[#fef3c7] text-foreground">Split</span>}
            {row._suppressed && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground line-through">Supp</span>}
            {row.billed_to_bfs && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">B</span>}
            {row.paid_to_ya && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">P</span>}
            {row.invoiced_to_ya && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-800">I</span>}
            {tier === "gabe" && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-blue-200 text-blue-900">Gabe</span>}
            {tier === "mine" && <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-violet-200 text-violet-900">Manual</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-sm font-bold tabular-nums text-accent">${formatMoney(row.fee_amt)}</div>
            <div className="text-xs text-muted-foreground">
              {row.fee_type === 'profit_split' ? `profit $${formatMoney(computeProfit(row))}` : `labor $${formatMoney(row.labor_amt)}`}
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
            <span className="text-xs text-muted-foreground">Billable</span>
            <EditableSwitch checked={row.billable} onCommit={(c) => onEdit(row.id, { billable: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Needs review</span>
            <EditableSwitch checked={row.needs_review} onCommit={(c) => onEdit(row.id, { needs_review: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Billed to BFS</span>
            <EditableSwitch checked={row.billed_to_bfs} onCommit={(c) => onEdit(row.id, { billed_to_bfs: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Paid to YA</span>
            <EditableSwitch checked={row.paid_to_ya} onCommit={(c) => onEdit(row.id, { paid_to_ya: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Invoiced to YA</span>
            <EditableSwitch checked={row.invoiced_to_ya} onCommit={(c) => onEdit(row.id, { invoiced_to_ya: c })} />
          </div>
          <EditableField label="Paid date" value={row.paid_date} type="date" onCommit={(v) => onEdit(row.id, { paid_date: v })} />
          <Detail label="Fee math" value={feeMathString(row)} mono />
          {row.note_text && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Note (verbatim)</div>
              <div className="rounded bg-white border border-border p-2 text-sm whitespace-pre-wrap">{row.note_text}</div>
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
                <img key={i} src={url} alt={`photo ${i + 1}`} className="h-12 w-12 rounded object-cover border border-border" />
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
      <span className="text-xs text-muted-foreground w-20">{label}</span>
      <div className="flex-1">
        <EditableText value={value} type={type} displayFormat={displayFormat} onCommit={onCommit} />
      </div>
    </div>
  );
}

function PayBadge({ letter, active, title, activeClass }) {
  return (
    <span title={title} className={cn(
      "text-[9px] font-bold uppercase w-4 h-4 rounded flex items-center justify-center leading-none",
      active ? activeClass : "bg-muted text-muted-foreground"
    )}>{letter}</span>
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
      });
    }
    const g = map.get(key);
    g.lines.push(r);
    if (!r._suppressed) g.feeTotal += Number(r.fee_amt) || 0;
  }
  return Array.from(map.values());
}
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Calendar, HardDrive, Layers } from "lucide-react";
import { feeMathString, formatMoney } from "@/lib/feeMath";
import { EditableText, EditableSwitch, AdjustedMarker } from "@/components/fees/EditableCell";
import { cn } from "@/lib/utils";

// rows: fee lines for selected month
// jobs: map id->job
// onEdit(id, patch)
export default function FeeTable({ rows, jobsById, onEdit, stickyTop = 0 }) {
  const groups = useMemo(() => groupByJob(rows, jobsById), [rows, jobsById]);

  return (
    <section className="px-4 sm:px-8 pt-6 pb-16">
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide mb-3">
        By Job
      </h2>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border border-border">
        <div
          className="sticky z-10 grid grid-cols-[1.6fr_0.8fr_1.4fr_0.8fr_0.8fr_0.7fr_0.5fr] gap-2 px-4 py-3 bg-primary text-primary-foreground text-[11px] uppercase tracking-wide font-semibold rounded-t-lg shadow-sm"
          style={{ top: stickyTop }}
        >
          <div>Job</div>
          <div>Date</div>
          <div>Line</div>
          <div className="text-right">Labor $</div>
          <div className="text-right">Fee %</div>
          <div>Source</div>
          <div className="text-center">Flags</div>
        </div>
        <div className="divide-y divide-border rounded-b-lg overflow-hidden">
          {groups.map((g) => (
            <JobGroup key={g.key} group={g} onEdit={onEdit} />
          ))}
          {!groups.length && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No fee lines this month.</div>
          )}
        </div>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {groups.map((g) => (
          <MobileJobGroup key={g.key} group={g} onEdit={onEdit} />
        ))}
        {!groups.length && (
          <div className="py-10 text-center text-sm text-muted-foreground">No fee lines this month.</div>
        )}
      </div>
    </section>
  );
}

function JobGroup({ group, onEdit }) {
  const [open, setOpen] = useState(true);
  const jobName = group.jobName;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted hover:bg-muted/70 text-left border-l-2 border-l-primary"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="font-semibold text-sm text-foreground">{jobName}</span>
        <span className="text-xs text-muted-foreground">· {group.lines.length} line{group.lines.length === 1 ? "" : "s"}</span>
        <span className="ml-auto text-sm font-bold tabular-nums text-primary">${formatMoney(group.feeTotal)}</span>
      </button>
      {open && (
        <div>
          {group.lines.map((row, i) => (
            <DesktopRow key={row.id} row={row} onEdit={onEdit} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function DesktopRow({ row, onEdit, index }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div
        className={cn(
          "grid grid-cols-[1.6fr_0.8fr_1.4fr_0.8fr_0.8fr_0.7fr_0.5fr] gap-2 px-4 py-2 items-center cursor-pointer hover:bg-accent/60",
          row.needs_review ? "bg-amber-50" : (index % 2 === 1 ? "bg-muted/30" : "")
        )}
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="truncate text-sm text-muted-foreground">{row.job_name_norm}</span>
        </div>
        <div className="text-sm text-muted-foreground">{row.job_date}</div>
        <div>
          <EditableText value={row.line_description} onCommit={(v) => onEdit(row.id, { line_description: v })} />
        </div>
        <div className="text-right">
          <EditableText value={row.labor_amt} type="number" alignRight onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
        </div>
        <div className="flex items-center justify-end gap-1">
          <EditableText value={Math.round((row.fee_pct || 0) * 100)} type="number" alignRight className="w-14" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
        <div><SourceBadge source={row.source} /></div>
        <div className="flex items-center justify-center gap-1.5">
          {row.manually_adjusted && <AdjustedMarker />}
          {row.needs_review && <span title="Needs review" className="h-2 w-2 rounded-full bg-amber-500" />}
        </div>
      </div>
      {expanded && <ExpandedDetail row={row} onEdit={onEdit} />}
    </div>
  );
}

function ExpandedDetail({ row, onEdit }) {
  return (
    <div className="px-6 pb-4 pt-1 bg-muted/20 border-t border-border">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
        <div className="space-y-2">
          <Detail label="Fee math" value={feeMathString(row)} mono />
          <Detail label="Labor $" value={`$${formatMoney(row.labor_amt)}`} />
          <Detail label="Fee $" value={`$${formatMoney(row.fee_amt)}`} />
          <Detail label="Fee %" value={`${Math.round((row.fee_pct || 0) * 100)}%`} />
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <EditableSwitch checked={row.billable} onCommit={(c) => onEdit(row.id, { billable: c })} />
              <span className="text-xs text-muted-foreground">Billable</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <EditableSwitch checked={row.needs_review} onCommit={(c) => onEdit(row.id, { needs_review: c })} />
              <span className="text-xs text-muted-foreground">Needs review</span>
            </label>
          </div>
        </div>
        <div className="space-y-2">
          {row.note_text && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Note (verbatim)</div>
              <div className="rounded bg-background border border-border p-2 text-sm whitespace-pre-wrap">{row.note_text}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Detail label="Man hours" value={row.man_hours ?? "—"} />
            <Detail label="Trip charges" value={row.trip_charges ?? "—"} />
            <Detail label="Calendar event id" value={row.calendar_event_id || "—"} />
            <Detail label="Probuild post id" value={row.probuild_post_id || "—"} />
          </div>
          {row.photo_urls && row.photo_urls.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Photos</div>
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
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-2">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}

function SourceBadge({ source }) {
  const map = {
    calendar: { icon: Calendar, label: "Cal", cls: "bg-blue-100 text-blue-800" },
    probuild: { icon: HardDrive, label: "PB", cls: "bg-emerald-100 text-emerald-800" },
    both: { icon: Layers, label: "Both", cls: "bg-violet-100 text-violet-800" },
  };
  const m = map[source] || map.calendar;
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium", m.cls)}>
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

// Mobile
function MobileJobGroup({ group, onEdit }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 bg-muted text-left">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{group.jobName}</div>
          <div className="text-xs text-muted-foreground">{group.lines.length} line{group.lines.length === 1 ? "" : "s"}</div>
        </div>
        <span className="ml-auto font-semibold text-sm tabular-nums">${formatMoney(group.feeTotal)}</span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {group.lines.map((row) => (
            <MobileRow key={row.id} row={row} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileRow({ row, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={cn("px-4 py-3", row.needs_review && "bg-amber-50/40")}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.line_description || row.job_name_norm}</div>
          <div className="text-xs text-muted-foreground">{row.job_date} · <SourceBadge source={row.source} /></div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">${formatMoney(row.fee_amt)}</div>
          <div className="text-xs text-muted-foreground">labor ${formatMoney(row.labor_amt)}</div>
        </div>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <EditableField label="Line" value={row.line_description} onCommit={(v) => onEdit(row.id, { line_description: v })} />
          <EditableField label="Labor $" value={row.labor_amt} type="number" onCommit={(v) => onEdit(row.id, { labor_amt: v })} />
          <EditableField label="Fee %" value={Math.round((row.fee_pct || 0) * 100)} type="number" onCommit={(v) => onEdit(row.id, { fee_pct: v == null || v === "" ? null : Number(v) / 100 })} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Billable</span>
            <EditableSwitch checked={row.billable} onCommit={(c) => onEdit(row.id, { billable: c })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Needs review</span>
            <EditableSwitch checked={row.needs_review} onCommit={(c) => onEdit(row.id, { needs_review: c })} />
          </div>
          <Detail label="Fee math" value={feeMathString(row)} mono />
          {row.note_text && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Note (verbatim)</div>
              <div className="rounded bg-background border border-border p-2 text-sm whitespace-pre-wrap">{row.note_text}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Detail label="Man hours" value={row.man_hours ?? "—"} />
            <Detail label="Trip charges" value={row.trip_charges ?? "—"} />
            <Detail label="Cal event id" value={row.calendar_event_id || "—"} />
            <Detail label="PB post id" value={row.probuild_post_id || "—"} />
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

function EditableField({ label, value, onCommit, type }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-20">{label}</span>
      <div className="flex-1">
        <EditableText value={value} type={type} onCommit={onCommit} />
      </div>
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
      });
    }
    const g = map.get(key);
    g.lines.push(r);
    g.feeTotal += Number(r.fee_amt) || 0;
  }
  return Array.from(map.values());
}
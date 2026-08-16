import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, MapPin, Calendar, User, Hash, DollarSign, AlertTriangle, Clock, CheckCircle2, Activity } from "lucide-react";
import { formatMoney } from "@/lib/feeMath";
import { cn } from "@/lib/utils";

function deriveJobStatus(rows) {
  const today = new Date().toISOString().slice(0, 10);
  const calendarRows = rows.filter(r => r.source === 'calendar' || r.source === 'both');
  const probuildRows = rows.filter(r => r.source === 'probuild' || r.source === 'both');
  const futureEvents = calendarRows.filter(r => (r.job_date || '') > today);
  const pastEvents = calendarRows.filter(r => (r.job_date || '') <= today);
  const hasWin2 = rows.some(r => r.ticket_sequence != null && r.ticket_sequence >= 2);
  const hasNeedsReview = rows.some(r => r.needs_review);
  const pastWithNoReport = pastEvents.filter(r =>
    !probuildRows.some(p => (p.job_date || '') === (r.job_date || ''))
  );

  if (hasWin2 || hasNeedsReview || pastWithNoReport.length > 0) {
    const reasons = [];
    if (hasWin2) reasons.push("rework ticket (win2+)");
    if (hasNeedsReview) reasons.push("rows needing review");
    if (pastWithNoReport.length > 0) reasons.push(`${pastWithNoReport.length} past event(s) with no field report`);
    return { status: "Needs Attention", reason: reasons.join("; "), level: "warn", icon: AlertTriangle };
  }
  if (futureEvents.length > 0 && probuildRows.length === 0) {
    return { status: "Scheduled", reason: `${futureEvents.length} future event(s), no field reports yet`, level: "info", icon: Clock };
  }
  if (futureEvents.length > 0 && probuildRows.length > 0) {
    return { status: "In Progress", reason: `${probuildRows.length} field report(s), ${futureEvents.length} future event(s) remaining`, level: "active", icon: Activity };
  }
  if (probuildRows.length > 0 && futureEvents.length === 0) {
    const sorted = [...probuildRows].sort((a, b) => (b.job_date || '').localeCompare(a.job_date || ''));
    const latest = sorted[0];
    const text = (latest.note_text || latest.line_description || '').toLowerCase();
    const incompleteWords = ['incomplete', 'partial', 'not done', 'still needs', 'remaining', 'not finished', 'pending', 'did not', "didn't"];
    const isIncomplete = incompleteWords.some(w => text.includes(w));
    if (isIncomplete) {
      return { status: "In Progress", reason: `most recent report (${latest.job_date}) indicates incomplete work`, level: "active", icon: Activity };
    }
    return { status: "Complete", reason: `most recent report ${latest.job_date}, no future events`, level: "done", icon: CheckCircle2 };
  }
  return { status: "No Activity", reason: "no calendar events or field reports", level: "idle", icon: Clock };
}

function groupByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    const d = r.job_date || '—';
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(r);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const jb = await base44.entities.Jobs.get(id);
        const fl = await base44.entities.FeeLines.filter({ job_id: id }, '-job_date', 5000);
        setJob(jb);
        setRows(fl);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const status = useMemo(() => deriveJobStatus(rows), [rows]);
  const totals = useMemo(() => ({
    labor: rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0),
    fee: rows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0),
  }), [rows]);
  const dates = useMemo(() => {
    const ds = rows.map(r => r.job_date).filter(Boolean).sort();
    return { first: ds[0], last: ds[ds.length - 1], visits: new Set(ds).size };
  }, [rows]);
  const grouped = useMemo(() => groupByDate(rows), [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="px-8 pt-16 text-center">
        <p className="text-sm text-muted-foreground">Job not found.</p>
        <Link to="/jobs" className="text-accent text-sm mt-2 inline-block">← Back to Jobs</Link>
      </div>
    );
  }

  const StatusIcon = status.icon;
  const statusColors = {
    warn: "bg-accent text-accent-foreground",
    info: "bg-muted text-foreground",
    active: "bg-primary text-primary-foreground",
    done: "bg-[#dffcf5] text-foreground",
    idle: "bg-muted text-muted-foreground",
  };

  return (
    <div className="px-4 sm:px-8 pt-6 pb-16 max-w-5xl">
      <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" />
        Back to Jobs
      </Link>

      {/* HEADER */}
      <div className="rounded-lg border border-border bg-white p-6 mb-4">
        <h1 className="font-heading text-2xl font-bold uppercase tracking-tight mb-3">
          {job.canonical_name}
        </h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {job.builder && (
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Builder:</span>
              <span className="font-medium">{job.builder}</span>
            </div>
          )}
          {job.address && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Address:</span>
              <span className="font-medium">{job.address}</span>
            </div>
          )}
          {dates.first && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Activity:</span>
              <span className="font-medium">{dates.first} → {dates.last}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Visits:</span>
            <span className="font-medium">{dates.visits}</span>
          </div>
          {(job.po_numbers || []).length > 0 && (
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">POs:</span>
              <span className="font-medium">{job.po_numbers.join(", ")}</span>
            </div>
          )}
          {(job.oe_numbers || []).length > 0 && (
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">OEs:</span>
              <span className="font-medium">{job.oe_numbers.join(", ")}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Total:</span>
            <span className="font-medium tabular-nums">${formatMoney(totals.labor)} labor</span>
            <span className="font-medium tabular-nums text-accent">· ${formatMoney(totals.fee)} fee</span>
          </div>
        </div>
      </div>

      {/* STATUS */}
      <div className="rounded-lg border border-border bg-[#f9f9f9] p-4 mb-6">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide", statusColors[status.level])}>
            <StatusIcon className="h-3.5 w-3.5" />
            {status.status}
          </span>
          <span className="text-sm text-muted-foreground">{status.reason}</span>
        </div>
      </div>

      {/* TIMELINE */}
      <h2 className="font-heading text-xs font-bold uppercase tracking-widest mb-4">Timeline</h2>
      <div className="space-y-6">
        {grouped.map(([date, dateRows]) => (
          <div key={date}>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground tabular-nums">{date}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3">
              {dateRows.map((row) => (
                <TimelineEntry key={row.id} row={row} onPhotoClick={setLightbox} />
              ))}
            </div>
          </div>
        ))}
        {!grouped.length && (
          <div className="py-10 text-center text-sm text-muted-foreground">No activity recorded.</div>
        )}
      </div>

      {/* PHOTO LIGHTBOX */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="photo" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function TimelineEntry({ row, onPhotoClick }) {
  const isCalendar = row.source === 'calendar' || row.source === 'both';
  const isProbuild = row.source === 'probuild' || row.source === 'both';
  return (
    <div className="rounded-lg border border-border bg-white p-4 border-l-4 border-l-[#A1E9E6]">
      <div className="flex items-center gap-2 mb-2">
        {isCalendar && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#dffcf5] text-foreground">
            Scheduled
          </span>
        )}
        {isProbuild && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#fce4ec] text-foreground">
            Field Report
          </span>
        )}
        {row.ticket_sequence != null && row.ticket_sequence >= 2 && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
            Rework #{row.ticket_sequence}
          </span>
        )}
        {row.needs_review && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
            Review
          </span>
        )}
        {row.calendar_creator && (
          <span className="text-xs text-muted-foreground ml-auto truncate">{row.calendar_creator}</span>
        )}
      </div>
      {row.line_description && (
        <p className="text-sm font-medium mb-2">{row.line_description}</p>
      )}
      {row.note_text && (
        <div className="text-sm text-muted-foreground whitespace-pre-wrap mb-2 bg-[#f9f9f9] rounded p-3 border border-border">
          {row.note_text}
        </div>
      )}
      {row.photo_urls && row.photo_urls.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {row.photo_urls.map((url, i) => (
            <button
              key={i}
              onClick={() => onPhotoClick(url)}
              className="h-16 w-16 rounded border border-border overflow-hidden hover:opacity-80 transition-opacity"
            >
              <img src={url} alt={`photo ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="tabular-nums">Labor: ${formatMoney(row.labor_amt)}</span>
        <span className="tabular-nums text-accent">Fee: ${formatMoney(row.fee_amt)}</span>
        {row.man_hours != null && <span>{row.man_hours} hrs</span>}
        {row.trip_charges != null && <span>{row.trip_charges} trips</span>}
      </div>
    </div>
  );
}
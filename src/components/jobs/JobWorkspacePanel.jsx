import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, ArrowUpRight, Building2, HardHat, MapPin, ExternalLink } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { jobsStatus, sanitizeText } from "@/lib/jobsSanitize";
import { fetchAllPages } from "@/lib/pagination";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import FeedImage from "@/components/jobs/FeedImage";

const PM_RE = /\b(pm|superintendent|project manager|construction manager|field manager|lead)\b/i;

function qualifierOf(c) {
  const b = c.builder || "";
  const co = c.company || "";
  if (b && co.startsWith(b)) return co.slice(b.length).replace(/^\s*[-–—:]\s*/, "").trim();
  return co;
}

function pickPm(contacts) {
  for (const c of contacts || []) {
    if (PM_RE.test(qualifierOf(c))) return c;
  }
  return null;
}

// Right panel of the desktop Jobs workspace: compact facts header (builder, PM,
// address, status, actions) + the unified activity feed (clamped notes, auth
// photos). Reuses the same feed as the Job Detail page.
export default function JobWorkspacePanel({ jobId }) {
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [fieldReports, setFieldReports] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [currentUser, setCurrentUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const v = useRef(0);

  useEffect(() => {
    base44.auth.me().then((m) => setCurrentUser(m?.email || m?.full_name || "")).catch(() => {});
  }, []);

  const load = async () => {
    if (!jobId) {
      setJob(null); setRows([]); setNotes([]); setCalEvents([]); setFieldReports([]); setContacts([]);
      setLoading(false);
      return;
    }
    const ver = ++v.current;
    setLoading(true);
    setCalEvents([]);
    try {
      const [jb, fl, nt] = await Promise.all([
        base44.entities.Jobs.get(jobId),
        base44.entities.FeeLines.filter({ job_id: jobId }, "-job_date", 5000),
        base44.entities.JobNotes.filter({ job_id: jobId }, "-note_date", 500),
      ]);
      if (ver !== v.current) return;
      setJob(jb);
      setRows(fl);
      setNotes(nt);

      const calIds = new Set(fl.filter((r) => r.calendar_event_id).map((r) => r.calendar_event_id));
      const allCal = await fetchAllPages(base44.entities.CalendarEvents, "-event_date", 5000);
      if (ver !== v.current) return;
      setCalEvents(allCal.filter((e) => (e.job_id ? e.job_id === jobId : Boolean(e.google_event_id) && calIds.has(e.google_event_id))));

      const postIds = new Set(fl.map((r) => r.probuild_post_id).filter(Boolean));
      if (postIds.size) {
        const all = await fetchAllPages(base44.entities.FieldReports, "-created_date", 2000);
        if (ver === v.current) setFieldReports(all.filter((r) => r.post_id && postIds.has(r.post_id)));
      } else if (ver === v.current) {
        setFieldReports([]);
      }

      base44.functions.invoke("contacts-directory", { action: "job", job_id: jobId })
        .then((r) => { if (ver === v.current) setContacts(r.data?.contacts || []); })
        .catch(() => {});
    } finally {
      if (ver === v.current) setLoading(false);
    }
  };

  useEffect(() => {
    (async () => { await load(); })();
    return () => { v.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const status = useMemo(() => jobsStatus(rows), [rows]);
  const pm = pickPm(contacts);
  const mapHref = job?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.accent }} />
      </div>
    );
  }
  if (!job) {
    return <div className="flex items-center justify-center h-full text-[13px]" style={{ color: C.textMuted }}>Select a job to view its activity.</div>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-5 pt-6 pb-5" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.card }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-[28px] font-bold break-words leading-tight" style={{ color: C.text, letterSpacing: "-0.03em" }}>{sanitizeText(job.canonical_name)}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: status.bg, color: status.text }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.text }} />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em]">{status.label}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setShowReport(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: "#fff" }}>
              <Camera className="h-3.5 w-3.5" />Add field report
            </button>
            <Link to={`/jobs/${jobId}`} className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              Open full page <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3.5 text-[13px]" style={{ color: C.textSecondary }}>
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
            <span className="truncate">{sanitizeText(job.builder || "—")}</span>
          </span>
          {pm && (
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <HardHat className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
              <span className="truncate">{sanitizeText(pm.name)}</span>
              {pm.phone && <a href={`tel:${String(pm.phone).replace(/\s/g, "")}`} className="hover:underline shrink-0" style={{ color: C.accentText }}>{pm.phone}</a>}
            </span>
          )}
          {job.address && (
            <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-w-0 hover:underline" style={{ color: C.accentText }}>
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{sanitizeText(job.address)}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto obsidian-scroll px-5 py-5">
        <JobActivityFeed
          jobId={jobId}
          events={calEvents}
          rows={rows}
          notes={notes}
          fieldReports={fieldReports}
          currentUser={currentUser}
          onChanged={load}
          onPhotoClick={setLightbox}
        />
      </div>

      {showReport && (
        <JobFieldReportModal jobId={jobId} jobName={job.canonical_name} events={calEvents} onClose={() => setShowReport(false)} onDone={() => { setShowReport(false); load(); }} />
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,.85)" }} onClick={() => setLightbox(null)}>
          <FeedImage src={lightbox} alt="photo" className="max-w-full max-h-full rounded-[12px]" />
        </div>
      )}
    </div>
  );
}
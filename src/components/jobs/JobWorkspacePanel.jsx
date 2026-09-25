import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, ArrowUpRight, Building2, HardHat, MapPin, ExternalLink, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { jobsStatus, sanitizeText } from "@/lib/jobsSanitize";
import { fetchAllPages } from "@/lib/pagination";
import { ROLE_LABELS } from "@/lib/jobContacts";
import { useJobContacts } from "@/hooks/use-job-contacts";
import { loadJobActivity, jobEventsAndEvidence, reportsForJob, loadUniqueLegacyNames } from "@/lib/jobGroupData";
import DuplicateJobNotice from "@/components/jobs/DuplicateJobNotice";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import { AttachmentViewer } from "@/components/jobs/FeedImage";
import JobEventDocuments, { eventAttachments } from "@/components/jobs/JobEventDocuments";

// Superintendent first, then project manager, from the read-only job contacts join.
function pickLead(linked) {
  return linked.find((c) => c.role === "superintendent") || linked.find((c) => c.role === "project_manager") || null;
}

// Right panel of the desktop Jobs workspace: compact facts header (builder, PM,
// address, status, actions) + the unified activity feed (clamped notes, auth
// photos). Reuses the same feed as the Job Detail page. `group` is the read-only
// duplicate group from lib/jobDedupe.js; activity of every member record is shown.
export default function JobWorkspacePanel({ jobId, group = null }) {
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [evidence, setEvidence] = useState(null);
  const [fieldReports, setFieldReports] = useState([]);
  const memberKey = [jobId, ...(group?.memberIds || []).filter((m) => m !== jobId)].join(",");
  const memberIds = memberKey.split(",");
  const jobContacts = useJobContacts(jobId);
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
      setJob(null); setRows([]); setNotes([]); setCalEvents([]); setEvidence(null); setFieldReports([]);
      setLoading(false);
      return;
    }
    const ver = ++v.current;
    setLoading(true);
    setCalEvents([]);
    setEvidence(null);
    try {
      const [jb, activity] = await Promise.all([
        base44.entities.Jobs.get(jobId),
        loadJobActivity(memberIds),
      ]);
      if (ver !== v.current) return;
      const { rows: fl, notes: nt } = activity;
      setJob(jb);
      setRows(fl);
      setNotes(nt);

      const [allCal, names] = await Promise.all([
        fetchAllPages(base44.entities.CalendarEvents, "-event_date", 5000),
        loadUniqueLegacyNames(memberIds).catch(() => []),
      ]);
      if (ver !== v.current) return;
      const shown = jobEventsAndEvidence(allCal, memberIds, fl, nt, names);
      setCalEvents(shown.events);
      setEvidence(shown.evidence);

      const postIds = new Set(fl.map((r) => r.probuild_post_id).filter(Boolean));
      const all = await fetchAllPages(base44.entities.FieldReports, "-created_date", 2000);
      if (ver === v.current) setFieldReports(reportsForJob(all, memberIds, postIds, names));
    } finally {
      if (ver === v.current) setLoading(false);
    }
  };

  useEffect(() => {
    (async () => { await load(); })();
    return () => { v.current++; };
  }, [jobId, memberKey]);

  const status = useMemo(() => jobsStatus(rows, evidence), [rows, evidence]);
  const contactView = jobContacts.view?.job?.id === jobId ? jobContacts.view : null;
  const pm = pickLead(contactView?.linked || []);
  const missingSuper = Boolean(contactView?.status?.missing_superintendent);
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
            <span className="inline-flex items-center gap-1.5 min-w-0" title={ROLE_LABELS[pm.role]}>
              <HardHat className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
              <span className="truncate">{sanitizeText(pm.name)}</span>
              {pm.phone && <a href={`tel:${pm.phone_key || String(pm.phone).replace(/\s/g, "")}`} className="hover:underline shrink-0" style={{ color: C.accentText }}>{pm.phone}</a>}
            </span>
          )}
          {missingSuper && (
            <Link to={`/jobs/${jobId}`} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium" style={{ backgroundColor: C.amberLight, color: C.amber }} title="Open the job page to review suggested contacts">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {contactView.status.missing_contact ? "No contacts linked" : "No super linked"}
              {contactView.status.suggestions > 0 ? ` · ${contactView.status.suggestions} suggested` : ""}
            </Link>
          )}
          {job.address && (
            <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-w-0 hover:underline" style={{ color: C.accentText }}>
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{sanitizeText(job.address)}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}
        </div>
        <DuplicateJobNotice group={group} currentId={jobId} className="mt-3" />
        {eventAttachments(calEvents).length > 0 && (
          <div className="mt-3 rounded-[10px] px-3.5 py-2.5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
            <div className="mono-label-sm mb-1.5">Event documents</div>
            <JobEventDocuments events={calEvents} />
          </div>
        )}
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

      {lightbox && <AttachmentViewer src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

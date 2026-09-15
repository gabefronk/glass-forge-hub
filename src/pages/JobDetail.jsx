import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Camera, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { jobsStatus, sanitizeText } from "@/lib/jobsSanitize";
import JobFactsRail from "@/components/jobs/JobFactsRail";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import FeedImage from "@/components/jobs/FeedImage";
import { fetchAllPages } from "@/lib/pagination";

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [plans, setPlans] = useState([]);
  const [fieldReports, setFieldReports] = useState([]);
  const [currentUser, setCurrentUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const loadVersion = useRef(0);

  const loadAll = async () => {
    const version = ++loadVersion.current;
    setCalEvents([]);
    const [jb, fl, nt, me] = await Promise.all([
      base44.entities.Jobs.get(id),
      base44.entities.FeeLines.filter({ job_id: id }, "-job_date", 5000),
      base44.entities.JobNotes.filter({ job_id: id }, "-note_date", 500),
      base44.auth.me().catch(() => null),
    ]);
    if (version !== loadVersion.current) return;
    setJob(jb);
    setRows(fl);
    setNotes(nt);
    if (me) setCurrentUser(me.email || me.full_name || "");

    const calIds = new Set(fl.filter((r) => r.calendar_event_id).map((r) => r.calendar_event_id));
    const allCal = await fetchAllPages(base44.entities.CalendarEvents, "-event_date", 5000);
    if (version === loadVersion.current) setCalEvents(allCal.filter((e) => (e.job_id ? e.job_id === id : Boolean(e.google_event_id) && calIds.has(e.google_event_id))));

    const postIds = new Set(fl.map((r) => r.probuild_post_id).filter(Boolean));
    if (postIds.size) {
      const allReports = await fetchAllPages(base44.entities.FieldReports, "-created_date", 2000);
      if (version === loadVersion.current) setFieldReports(allReports.filter((r) => r.post_id && postIds.has(r.post_id)));
    } else if (version === loadVersion.current) {
      setFieldReports([]);
    }

    base44.functions.invoke("contacts-directory", { action: "job", job_id: id })
      .then((r) => { if (version === loadVersion.current) setContacts(r.data?.contacts || []); })
      .catch(() => {});

    base44.entities.PlanIntake.list("-created_date", 200)
      .then((all) => {
        if (version !== loadVersion.current) return;
        const linked = all.filter((p) =>
          (jb.source_window_quote_id && p.quote_id === jb.source_window_quote_id) ||
          (p.job_name && jb.canonical_name && p.job_name.toLowerCase() === jb.canonical_name.toLowerCase())
        );
        setPlans(linked);
      })
      .catch(() => {});
  };

  useEffect(() => {
    let current = true;
    setLoading(true);
    (async () => {
      try { await loadAll(); } finally { if (current) setLoading(false); }
    })();
    return () => { current = false; loadVersion.current++; };
  }, [id]);

  const status = useMemo(() => jobsStatus(rows), [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: "#DDE3EC", borderTopColor: C.accent }} />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="px-6 pt-16 text-center" style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
        <p className="text-[14px]" style={{ color: C.textMuted }}>Job not found.</p>
        <Link to="/jobs" style={{ color: C.accent }} className="text-[13px] mt-2 inline-block">← Back to Jobs</Link>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="job-page px-5 max-[699px]:px-4 pt-5 max-[699px]:pt-4 pb-24 lg:pb-10">
        {/* Compact header */}
        <div className="max-w-[1240px] mx-auto">
          <Link to="/jobs" className="inline-flex items-center gap-1 text-[13px] mb-3 transition-colors hover:opacity-80" style={{ color: C.accentText }}>
            <ArrowLeft className="h-3.5 w-3.5" />Back to jobs
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-0 flex-1">
              <div className="mono-label-sm mb-1 break-words">{sanitizeText(job.builder || "—")}</div>
              <h1 className="break-words font-heading text-[28px] sm:text-[30px] font-semibold leading-tight" style={{ color: C.text, letterSpacing: "-0.03em" }}>{sanitizeText(job.canonical_name)}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {job.address && <span className="text-[12px] break-words" style={{ color: C.textMuted }}>{sanitizeText(job.address)}</span>}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.text }} />
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em]">{status.label}</span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => setShowReport(true)} className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>
                <Camera className="h-3.5 w-3.5" />Add field report
              </button>
              <a href="#add-note" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
                <Plus className="h-3.5 w-3.5" />Add note
              </a>
            </div>
          </div>
        </div>

        {/* Body: facts rail + activity feed */}
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-4 lg:sticky lg:top-6 self-start">
            <JobFactsRail job={job} contacts={contacts} plans={plans} />
          </aside>
          <div className="lg:col-span-8 min-w-0" id="add-note">
            <JobActivityFeed
              jobId={id}
              events={calEvents}
              rows={rows}
              notes={notes}
              fieldReports={fieldReports}
              currentUser={currentUser}
              onChanged={loadAll}
              onPhotoClick={setLightbox}
            />
          </div>
        </div>
      </div>

      {/* Mobile sticky Add field report action */}
      <div className="lg:hidden fixed left-0 right-0 z-30 px-4 pt-2 pb-3" style={{ bottom: "calc(68px + env(safe-area-inset-bottom))", backgroundColor: C.pageBg, borderTop: `1px solid ${C.border}` }}>
        <button type="button" onClick={() => setShowReport(true)} className="w-full inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-full text-[13px] font-semibold" style={{ backgroundColor: C.accent, color: C.accentDark }}>
          <Camera className="h-4 w-4" />Add field report
        </button>
      </div>

      {showReport && (
        <JobFieldReportModal jobId={id} jobName={job.canonical_name} events={calEvents} onClose={() => setShowReport(false)} onDone={() => { setShowReport(false); loadAll(); }} />
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,.85)" }} onClick={() => setLightbox(null)}>
          <FeedImage src={lightbox} alt="photo" className="max-w-full max-h-full rounded-[12px]" />
        </div>
      )}
    </div>
  );
}
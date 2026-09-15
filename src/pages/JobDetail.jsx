import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C, jobStatus } from "@/lib/feeUI";
import JobOperationalInfo from "@/components/jobs/JobOperationalInfo";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import { fetchAllPages } from "@/lib/pagination";

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [plans, setPlans] = useState([]);
  const [currentUser, setCurrentUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
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
    if (version === loadVersion.current) setCalEvents(allCal.filter((e) => e.job_id ? e.job_id === id : Boolean(e.google_event_id) && calIds.has(e.google_event_id)));

    // Contacts (owner-only; omit cleanly when unavailable)
    base44.functions.invoke("contacts-directory", { action: "job", job_id: id })
      .then((r) => { if (version === loadVersion.current) setContacts(r.data?.contacts || []); })
      .catch(() => {});

    // Plans / documents (admin-only; omit cleanly when unavailable)
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
      try {
        await loadAll();
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; loadVersion.current++; };
  }, [id]);

  const status = useMemo(() => jobStatus(rows), [rows]);
  const dates = useMemo(() => {
    const ds = rows.map((r) => r.job_date).filter(Boolean).sort();
    return { first: ds[0], last: ds[ds.length - 1], visits: new Set(ds).size };
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: "#DDE3EC", borderTopColor: C.accent }} />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="px-[26px] pt-16 text-center" style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
        <p className="text-[14px]" style={{ color: C.textMuted }}>Job not found.</p>
        <Link to="/jobs" style={{ color: C.accent }} className="text-[13px] mt-2 inline-block">← Back to Jobs</Link>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-16 max-w-3xl">
        <Link to="/jobs" className="inline-flex items-center gap-1 text-[13px] mb-4 transition-colors hover:opacity-80" style={{ color: C.accentText }}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to jobs
        </Link>

        {/* Job name + status */}
        <div className="mb-5">
          <div className="mono-label-sm mb-1 break-words">{job.builder || "—"}</div>
          <h1 className="break-words font-heading text-[22px] sm:text-[24px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>{job.canonical_name}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {dates.first && (
              <span className="font-mono-num text-[12px]" style={{ color: C.textMuted }}>
                {dates.first === dates.last ? dates.first : `${dates.first} → ${dates.last}`}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.text }} />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em]">{status.label}</span>
            </span>
          </div>
        </div>

        {/* Operational info */}
        <div className="mb-6">
          <JobOperationalInfo job={job} contacts={contacts} plans={plans} />
        </div>

        {/* Activity feed */}
        <JobActivityFeed
          jobId={id}
          events={calEvents}
          rows={rows}
          notes={notes}
          currentUser={currentUser}
          onChanged={loadAll}
          onPhotoClick={setLightbox}
        />
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,.85)" }} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="photo" className="max-w-full max-h-full rounded-[12px]" />
        </div>
      )}
    </div>
  );
}
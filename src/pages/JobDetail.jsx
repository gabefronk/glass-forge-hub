import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C, jobStatus, jobTotals } from "@/lib/feeUI";
import JobDetailHeader from "@/components/jobs/JobDetailHeader";
import Checklist, { CHECKLIST_TOTAL } from "@/components/jobs/Checklist";
import StageTimeline from "@/components/jobs/StageTimeline";
import SitePhotos from "@/components/jobs/SitePhotos";
import LineItems from "@/components/jobs/LineItems";
import NotesSection from "@/components/jobs/NotesSection";
import VisitReports from "@/components/jobs/VisitReports";
import { fetchAllPages } from "@/lib/pagination";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";

function computeStage(rows, job) {
  const billable = rows.filter((r) => Number(r.labor_amt) > 0);
  if (billable.length > 0 && billable.every((r) => r.billed_to_bfs)) return 4;
  const hasProbuild = rows.some((r) => r.source === "probuild" || r.source === "both");
  if (hasProbuild) return 3;
  const hasPO = (job?.po_numbers || []).length > 0 || (job?.oe_numbers || []).length > 0;
  if (hasPO) return 2;
  const today = new Date().toISOString().slice(0, 10);
  const hasPastEvents = rows.some((r) => (r.job_date || "") <= today);
  if (hasPastEvents) return 1;
  return 0;
}

export default function JobDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [currentUser, setCurrentUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [checkedItems, setCheckedItems] = useState(new Set());
  const [calEvents, setCalEvents] = useState([]);

  const loadAll = async () => {
    const [jb, fl, nt, me] = await Promise.all([
      base44.entities.Jobs.get(id),
      base44.entities.FeeLines.filter({ job_id: id }, "-job_date", 5000),
      base44.entities.JobNotes.filter({ job_id: id }, "-note_date", 500),
      base44.auth.me().catch(() => null),
    ]);
    setJob(jb);
    setRows(fl);
    setNotes(nt);
    if (me) setCurrentUser(me.email || me.full_name || "");
    // Load CalendarEvents for this job (matched via FeeLines' calendar_event_id)
    const calIds = new Set(fl.filter((r) => r.calendar_event_id).map((r) => r.calendar_event_id));
    if (calIds.size > 0) {
      const allCal = await fetchAllPages(base44.entities.CalendarEvents, "-event_date", 5000);
      setCalEvents(allCal.filter((e) => calIds.has(e.google_event_id)));
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await loadAll();
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const status = useMemo(() => jobStatus(rows), [rows]);
  const totals = useMemo(() => jobTotals(rows), [rows]);
  const dates = useMemo(() => {
    const ds = rows.map((r) => r.job_date).filter(Boolean).sort();
    return { first: ds[0], last: ds[ds.length - 1], visits: new Set(ds).size };
  }, [rows]);
  const stage = useMemo(() => computeStage(rows, job), [rows, job]);
  const photos = useMemo(() => {
    const urls = [];
    for (const r of rows) { if (r.photo_urls) urls.push(...r.photo_urls); }
    for (const n of notes) { if (n.attachments) urls.push(...n.attachments); }
    return urls;
  }, [rows, notes]);

  const toggleCheck = (i) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

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

  const acceptedSnapshot = job.accepted_quote_snapshot || {};
  const acceptedResult = acceptedSnapshot.result || {};
  const acceptedLines = acceptedResult.lines?.length ? acceptedResult.lines : (acceptedSnapshot.lines || []);
  const acceptedCount = acceptedLines.length && acceptedLines.every((line) => Number(line.qty ?? line.quantity) > 0)
    ? acceptedLines.reduce((sum, line) => sum + Number(line.qty ?? line.quantity), 0) : null;
  const acceptedTotal = acceptedResult.totals?.total ?? acceptedResult.totals?.customer_total;
  const acceptedPrice = acceptedTotal !== null && acceptedTotal !== undefined && Number.isFinite(Number(acceptedTotal))
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(acceptedTotal)) : "—";

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-16 max-w-6xl">
        <Link to="/jobs" className="inline-flex items-center gap-1 text-[13px] mb-4 transition-colors hover:opacity-80" style={{ color: C.accentText }}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to jobs
        </Link>

        {isAgentCenterOwner(user) && <><Link to={"/messages?job="+encodeURIComponent(id)} className="mb-4 ml-4 inline-flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm text-blue-700">Private job messages</Link><Link to={"/contacts?job="+encodeURIComponent(id)} className="mb-4 ml-4 inline-flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm text-blue-700">Job contacts</Link></>}
        <JobDetailHeader
          job={job}
          status={status}
          totals={totals}
          dates={dates}
          stage={stage}
          checklistDone={checkedItems.size}
          checklistTotal={CHECKLIST_TOTAL}
          onAddPhoto={() => setLightbox(null)}
        />

        {job.source_window_quote_id && (
          <Link to={`/window-quotes?quote=${encodeURIComponent(job.source_window_quote_id)}`} className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#C3D4EE] bg-[#E7EEFA] p-4 text-sm text-[#1E4A85] break-words [&>div]:min-w-0">
            <div><div className="font-semibold">Accepted window package</div><div className="mt-1 text-xs">AMSCO {acceptedResult.native_quote_number || "—"} · Revision {job.accepted_quote_revision || acceptedSnapshot.revision || "—"}</div></div>
            <div className="flex flex-wrap items-center gap-5">
              <div><div className="text-[10px] font-medium uppercase tracking-wide">Accepted customer total</div><div className="mt-1 text-lg font-semibold">{acceptedPrice}</div></div>
              <div><div className="text-[10px] font-medium uppercase tracking-wide">Windows / assemblies</div><div className="mt-1 text-lg font-semibold">{acceptedCount ?? "—"}</div></div>
              <span className="font-semibold">View quote →</span>
            </div>
          </Link>
        )}

        <div className="flex flex-col xl:flex-row gap-5 mt-5">
          {/* Left column */}
          <div className="flex-1 min-w-0 space-y-5">
            <Checklist checked={checkedItems} onToggle={toggleCheck} />
            {/* Site photos — mobile only (below checklist) */}
            <div className="xl:hidden">
              <SitePhotos photos={photos} onAddPhoto={() => {}} onPhotoClick={setLightbox} />
            </div>
          </div>

          {/* Right column */}
          <div className="min-w-0 xl:w-[340px] shrink-0 space-y-5">
            <StageTimeline currentStage={stage} />
            <LineItems rows={rows} />
            {/* Site photos — desktop only (right column) */}
            <div className="hidden xl:block">
              <SitePhotos photos={photos} onAddPhoto={() => {}} onPhotoClick={setLightbox} />
            </div>
            <NotesSection jobId={id} notes={notes} currentUser={currentUser} onChanged={loadAll} onPhotoClick={setLightbox} />
            <VisitReports events={calEvents} />
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ backgroundColor: "rgba(0,0,0,.85)" }} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="photo" className="max-w-full max-h-full rounded-[12px]" />
        </div>
      )}
    </div>
  );
}

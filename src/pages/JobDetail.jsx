import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C, jobStatus, jobTotals } from "@/lib/feeUI";
import JobDetailHeader from "@/components/jobs/JobDetailHeader";
import JobTimeline from "@/components/jobs/JobTimeline";
import JobRightRail from "@/components/jobs/JobRightRail";

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [currentUser, setCurrentUser] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  const loadAll = async () => {
    const [jb, fl, nt, me] = await Promise.all([
      base44.entities.Jobs.get(id),
      base44.entities.FeeLines.filter({ job_id: id }, '-job_date', 5000),
      base44.entities.JobNotes.filter({ job_id: id }, '-note_date', 500),
      base44.auth.me().catch(() => null),
    ]);
    setJob(jb);
    setRows(fl);
    setNotes(nt);
    if (me) setCurrentUser(me.email || me.full_name || "");
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
    const ds = rows.map(r => r.job_date).filter(Boolean).sort();
    return { first: ds[0], last: ds[ds.length - 1], visits: new Set(ds).size };
  }, [rows]);
  const lastSynced = useMemo(() => {
    const all = [...rows.map(r => r.job_date), ...notes.map(n => n.note_date)].filter(Boolean).sort();
    return all[all.length - 1] || null;
  }, [rows, notes]);

  const handleMarkBilled = async () => {
    const unbilled = rows.filter(r => !r.billed_to_bfs && Number(r.labor_amt) > 0);
    if (!unbilled.length) return;
    const updates = unbilled.map(r => ({ id: r.id, billed_to_bfs: true, manually_adjusted: true }));
    await base44.entities.FeeLines.bulkUpdate(updates);
    await loadAll();
  };

  const handleNoteSaved = async () => { setShowNoteForm(false); await loadAll(); };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.accentDark }} />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="px-8 pt-16 text-center" style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
        <p className="text-sm" style={{ color: C.text, opacity: 0.68 }}>Job not found.</p>
        <Link to="/jobs" style={{ color: C.accent }} className="text-sm mt-2 inline-block">← Back to Jobs</Link>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="px-4 sm:px-8 pt-6 pb-16 max-w-6xl">
        <Link to="/jobs" className="inline-flex items-center gap-1 text-sm mb-4 hover:underline" style={{ color: C.text, opacity: 0.68 }}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to jobs
        </Link>

        <JobDetailHeader job={job} status={status} totals={totals} dates={dates} onAddNote={() => setShowNoteForm(v => !v)} />

        <div className="flex flex-col lg:flex-row gap-6 mt-6">
          <div className="flex-1 min-w-0">
            <JobTimeline
              jobId={id}
              rows={rows}
              notes={notes}
              currentUser={currentUser}
              showNoteForm={showNoteForm}
              onNoteSaved={handleNoteSaved}
              onNoteCancel={() => setShowNoteForm(false)}
              onChanged={loadAll}
              onPhotoClick={setLightbox}
            />
          </div>
          <div className="lg:w-[300px] shrink-0">
            <JobRightRail job={job} totals={totals} rows={rows} lastSynced={lastSynced} onMarkBilled={handleMarkBilled} />
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="photo" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, HardHat } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { jobsStatus } from "@/lib/jobsSanitize";
import { fetchAllPages } from "@/lib/pagination";
import { useJobContacts } from "@/hooks/use-job-contacts";
import { useJobFolderFiles } from "@/hooks/use-job-folder-files";
import { useJobLive } from "@/hooks/use-job-live";
import { loadJobActivity, jobEventsAndEvidence, reportsForJob, loadUniqueLegacyNames } from "@/lib/jobGroupData";
import { jobSnapshot } from "@/lib/jobWorkspace";
import { planMatchesJob, renameJob } from "@/lib/jobRename";
import DuplicateJobNotice from "@/components/jobs/DuplicateJobNotice";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import { JobHero, JobFactsCard, ScopeCard, SheetCard, LiveMark, TILE, SHEET_BG, heroLinkClass, heroLinkStyle } from "@/components/jobs/JobSheet";
import { AttachmentViewer } from "@/components/jobs/FeedImage";
import { denverDate } from "../../../base44/shared/billingCore.js";

const MUTED = "#566063", TEAL = "#0b3f3b";


// Right side of the desktop Jobs workspace, as the job sheet: dark hero (name,
// address, super, next step, actions, files), the job facts, scope, then the
// live visit history. `group` is the read-only duplicate group from lib/jobDedupe.js;
// activity of every member record is shown.
export default function JobWorkspacePanel({ jobId, group = null, onJobChanged }) {
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [evidence, setEvidence] = useState(null);
  const [fieldReports, setFieldReports] = useState([]);
  const [plans, setPlans] = useState([]);
  const memberKey = [jobId, ...(group?.memberIds || []).filter((m) => m !== jobId)].join(",");
  const memberIds = memberKey.split(",");
  const jobContacts = useJobContacts(jobId);
  const [currentUser, setCurrentUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [openFormKey, setOpenFormKey] = useState(0);
  const historyRef = useRef(null);
  const v = useRef(0);
  const folder = useJobFolderFiles(job);

  useEffect(() => {
    base44.auth.me().then((m) => setCurrentUser(m?.email || m?.full_name || "")).catch(() => {});
  }, []);

  const load = async ({ quiet = false } = {}) => {
    if (!jobId) {
      setJob(null); setRows([]); setNotes([]); setCalEvents([]); setEvidence(null); setFieldReports([]); setPlans([]);
      setLoading(false);
      return;
    }
    const ver = ++v.current;
    if (!quiet) {
      setLoading(true);
      setCalEvents([]);
      setEvidence(null);
      setPlans([]);
    }
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
      if (!quiet) setLoading(false);

      base44.entities.PlanIntake.list("-created_date", 200)
        .then((all) => {
          if (ver !== v.current) return;
          setPlans(all.filter((p) => planMatchesJob(p, jb)));
        })
        .catch(() => {});

      const [allCal, names] = await Promise.all([
        fetchAllPages(base44.entities.CalendarEvents, "-event_date", 5000).catch(() => []),
        loadUniqueLegacyNames(memberIds).catch(() => []),
      ]);
      if (ver !== v.current) return;
      const shown = jobEventsAndEvidence(allCal, memberIds, fl, nt, names);
      setCalEvents(shown.events);
      setEvidence(shown.evidence);

      const postIds = new Set(fl.map((r) => r.probuild_post_id).filter(Boolean));
      const all = await fetchAllPages(base44.entities.FieldReports, "-created_date", 2000).catch(() => []);
      if (ver === v.current) setFieldReports(reportsForJob(all, memberIds, postIds, names));
    } finally {
      if (ver === v.current) setLoading(false);
    }
  };

  useEffect(() => {
    (async () => { await load(); })();
    return () => { v.current++; };
  }, [jobId, memberKey]);

  const live = useJobLive(jobId, {
    scope: () => ({
      memberIds,
      shownIds: [...notes.map((n) => n.id), ...calEvents.map((e) => e.id), ...fieldReports.map((r) => r.id)].filter(Boolean),
    }),
    reloadAll: () => load({ quiet: true }),
    reloadNotes: async () => {
      const { rows: fl, notes: nt } = await loadJobActivity(memberIds);
      setRows(fl);
      setNotes(nt);
    },
  });

  const today = denverDate();
  const status = useMemo(() => jobsStatus(rows, evidence), [rows, evidence]);
  const snap = useMemo(() => jobSnapshot({ job, events: calEvents, rows, fieldReports, status, today }), [job, calEvents, rows, fieldReports, status, today]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: "#e2dcd1", borderTopColor: TEAL }} />
      </div>
    );
  }
  if (!job) {
    return <div className="flex items-center justify-center h-full text-[13px]" style={{ color: MUTED }}>Select a job to see it here.</div>;
  }

  const logInteraction = () => {
    setOpenFormKey((k) => k + 1);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto obsidian-scroll" style={{ backgroundColor: SHEET_BG }}>
      <div className="px-6 pt-6 pb-10 flex flex-col gap-[18px] max-[1400px]:px-5">
        <JobHero
          job={job}
          status={status}
          snap={snap}
          jobContacts={jobContacts}
          events={calEvents}
          folder={folder}
          plans={plans}
          onFieldReport={() => setShowReport(true)}
          onLog={logInteraction}
          onRename={async (name) => { const next = await renameJob(job, name); setJob(next); onJobChanged?.(next); }}
          headingLevel="h2"
          extra={<Link to={`/jobs/${jobId}`} className={heroLinkClass} style={heroLinkStyle} title="Open the full job page">Full page<ArrowUpRight className="h-[15px] w-[15px]" style={{ color: "#e0c994" }} /></Link>}
        />

        <DuplicateJobNotice group={group} currentId={jobId} />
        <JobFactsCard snap={snap} folder={folder} />
        <ScopeCard snap={snap} />

        <div ref={historyRef} className="scroll-mt-4">
          <SheetCard icon={HardHat} tile={TILE.green} title="Visits" sub="notes, reports and calls, newest first" right={<LiveMark live={live} />}>
            <JobActivityFeed
              ledger
              jobId={jobId}
              events={calEvents}
              rows={rows}
              notes={notes}
              fieldReports={fieldReports}
              files={folder.files}
              live={live}
              currentUser={currentUser}
              onChanged={() => load({ quiet: true })}
              onPhotoClick={setLightbox}
              openFormKey={openFormKey}
              title="Visits"
            />
          </SheetCard>
        </div>
      </div>

      {showReport && (
        <JobFieldReportModal jobId={jobId} jobName={job.canonical_name} events={calEvents} onClose={() => setShowReport(false)} onDone={() => { setShowReport(false); load({ quiet: true }); }} />
      )}

      {lightbox && <AttachmentViewer src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

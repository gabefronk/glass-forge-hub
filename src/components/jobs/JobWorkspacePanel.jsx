import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, HardHat } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { jobsStatus } from "@/lib/jobsSanitize";
import { useJobContacts } from "@/hooks/use-job-contacts";
import { useJobFolderFiles } from "@/hooks/use-job-folder-files";
import { useJobLive } from "@/hooks/use-job-live";
import { loadJobActivity, jobEventsAndEvidence, loadJobEvents, loadJobFieldReports, loadUniqueLegacyNames } from "@/lib/jobGroupData";
import { uniqueLegacyNames } from "@/lib/jobLegacyNames";
import { jobSnapshot } from "@/lib/jobWorkspace";
import { planMatchesJob, renameJob } from "@/lib/jobRename";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { isPurchaseOrderOwner } from "@/lib/purchaseOrderAccess";
import DuplicateJobNotice from "@/components/jobs/DuplicateJobNotice";
import MergedJobBanner from "@/components/jobs/MergedJobBanner";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import { JobHero, SheetCard, LiveMark, TILE, SHEET_BG, heroLinkClass, heroLinkStyle } from "@/components/jobs/JobSheet";
import { jobProgress } from "@/lib/jobStages";
import { buildReports } from "@/lib/jobHistory";
import DeleteJobButton from "@/components/jobs/DeleteJobButton";
import { AttachmentViewer } from "@/components/jobs/FeedImage";
import { denverDate } from "../../../base44/shared/billingCore.js";

const MUTED = "#566063", TEAL = "#0b3f3b";


// Right side of the desktop Jobs workspace, as the job sheet: dark hero (name,
// address, super, next step, actions, files), the job facts, scope, then the
// live visit history. `group` is the read-only duplicate group from lib/jobDedupe.js;
// activity of every member record is shown.
export default function JobWorkspacePanel({ jobId, group = null, onJobChanged, onJobDeleted, preloaded = null }) {
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
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [openFormKey, setOpenFormKey] = useState(0);
  const historyRef = useRef(null);
  const v = useRef(0);
  const folder = useJobFolderFiles(job);

  useEffect(() => {
    base44.auth.me().then((m) => { setCurrentUser(m?.email || m?.full_name || ""); setCanDelete(isAgentCenterOwner(m) || isPurchaseOrderOwner(m)); }).catch(() => {});
  }, []);

  const load = async ({ quiet = false, skipActivity = false } = {}) => {
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
      // Live refreshes (reloadAll) fire on FieldReports/CalendarEvents changes —
      // FeeLines/JobNotes didn't change, so skip loadJobActivity and reuse the
      // rows/notes already on screen instead of re-reading them every refresh.
      // User actions (onChanged/onDone) pass skipActivity=false and refresh all.
      const jb = await base44.entities.Jobs.get(jobId);
      let fl = rows;
      let nt = notes;
      if (!skipActivity) {
        const activity = await loadJobActivity(memberIds);
        if (ver !== v.current) return;
        fl = activity.rows;
        nt = activity.notes;
        setRows(fl);
        setNotes(nt);
      }
      if (ver !== v.current) return;
      setJob(jb);
      if (!quiet) setLoading(false);

      base44.entities.PlanIntake.list("-created_date", 200)
        .then((all) => {
          if (ver !== v.current) return;
          setPlans(all.filter((p) => planMatchesJob(p, jb)));
        })
        .catch(() => {});

      // Avoid full-table scans on every job selection / live refresh: resolve
      // legacy names from the hub's preloaded Jobs, then fetch this job's
      // calendar events and field reports with bounded job-scoped queries
      // (fresh, so a just-added report shows immediately), merging in edge cases
      // (FeeLine-linked / legacy-name / post-id matches) from the hub's already-
      // loaded collections. Falls back to a full Jobs scan only when standalone.
      const names = preloaded?.jobs
        ? uniqueLegacyNames(preloaded.jobs, memberIds)
        : await loadUniqueLegacyNames(memberIds).catch(() => []);
      if (ver !== v.current) return;
      const postIds = new Set(fl.map((r) => r.probuild_post_id).filter(Boolean));
      const [allCal, allReports] = await Promise.all([
        loadJobEvents(memberIds, fl, preloaded?.calEvents, names),
        loadJobFieldReports(memberIds, postIds, preloaded?.fieldReports, names),
      ]);
      if (ver !== v.current) return;
      const shown = jobEventsAndEvidence(allCal, memberIds, fl, nt, names);
      setCalEvents(shown.events);
      setEvidence(shown.evidence);
      setFieldReports(allReports);
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
    reloadAll: () => load({ quiet: true, skipActivity: true }),
    reloadNotes: async () => {
      const { rows: fl, notes: nt } = await loadJobActivity(memberIds);
      setRows(fl);
      setNotes(nt);
    },
  });

  const today = denverDate();
  const status = useMemo(() => jobsStatus(rows, evidence), [rows, evidence]);
  const snap = useMemo(() => jobSnapshot({ job, events: calEvents, rows, fieldReports, status, today }), [job, calEvents, rows, fieldReports, status, today]);
  const progress = useMemo(() => jobProgress({ events: calEvents, reports: buildReports(rows, fieldReports), status, today }), [calEvents, rows, fieldReports, status, today]);

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
          progress={progress}
          extra={
            <>
              <Link to={`/jobs/${jobId}`} className={heroLinkClass} style={heroLinkStyle} title="Open the full job page">Full page<ArrowUpRight className="h-[15px] w-[15px]" style={{ color: "#e0c994" }} /></Link>
              {canDelete ? <DeleteJobButton job={job} onDeleted={() => onJobDeleted?.(job.id)} className={heroLinkClass} style={{ backgroundColor: "rgba(164,52,50,.16)", color: "#f1b9b3", border: "1px solid rgba(241,185,179,.3)" }} /> : null}
            </>
          }
        />

        <MergedJobBanner job={job} />
        <DuplicateJobNotice group={group} currentId={jobId} />

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
              dedupe={snap}
              progress={progress}
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
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Camera, FolderOpen, HardHat, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { jobsStatus } from "@/lib/jobsSanitize";
import JobFactsRail from "@/components/jobs/JobFactsRail";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import { AttachmentViewer } from "@/components/jobs/FeedImage";
import { fetchAllPages } from "@/lib/pagination";
import { useJobContacts } from "@/hooks/use-job-contacts";
import { loadJobGroup, loadJobActivity, jobEventsAndEvidence, reportsForJob, loadUniqueLegacyNames } from "@/lib/jobGroupData";
import DuplicateJobNotice from "@/components/jobs/DuplicateJobNotice";
import JobMoneyPanel from "@/components/jobs/JobMoneyPanel";
import JobLinkedRecords from "@/components/jobs/JobLinkedRecords";
import JobMessageThreads from "@/components/jobs/JobMessageThreads";
import OwnerSection from "@/components/jobs/OwnerSection";
import JobCostCard from "@/components/jobs/JobCostCard";
import JobHandoffCard from "@/components/jobs/JobHandoffCard";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { useAuth } from "@/lib/AuthContext";
import { isPurchaseOrderOwner } from "@/lib/purchaseOrderAccess";
import { canWriteJobDocuments } from "../../base44/shared/jobDocumentsAccess.mjs";
import { JobHero, JobFactsCard, ScopeCard, SheetCard, LiveMark, TILE, SHEET_BG, heroLinkClass, heroLinkStyle } from "@/components/jobs/JobSheet";
import { jobSnapshot } from "@/lib/jobWorkspace";
import { planMatchesJob, renameJob } from "@/lib/jobRename";
import { denverDate } from "../../base44/shared/billingCore.js";
import { useJobFolderFiles } from "@/hooks/use-job-folder-files";
import { useJobLive } from "@/hooks/use-job-live";

export default function JobDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const jobContacts = useJobContacts(id);
  const [plans, setPlans] = useState([]);
  const [folderId, setFolderId] = useState("");
  const [folderError, setFolderError] = useState("");
  const [linkingFolder, setLinkingFolder] = useState(false);
  const [fieldReports, setFieldReports] = useState([]);
  const [group, setGroup] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [openFormKey, setOpenFormKey] = useState(0);
  const loadVersion = useRef(0);
  const folder = useJobFolderFiles(job);
  // Kept in refs so the realtime listener always sees the current job.
  const liveRef = useRef({ memberIds: [id], shownIds: [] });
  liveRef.current = {
    memberIds: [id, ...(group?.memberIds || [])],
    shownIds: [...notes.map((n) => n.id), ...calEvents.map((e) => e.id), ...fieldReports.map((r) => r.id)].filter(Boolean),
  };

  const attachFolder = async () => {
    setLinkingFolder(true);setFolderError("");
    try { const r=(await base44.functions.invoke("job-documents",{action:"attach_folder",job_id:id,folder_id:folderId.trim()})).data;if(r?.error)throw Error(r.error);setFolderId("");await loadAll(); }
    catch(e){setFolderError(e.message||"Drive folder could not be linked.");}
    finally{setLinkingFolder(false);}
  };
  const unlinkFolder = async () => {
    if (!window.confirm("Unlink this job's Drive folder? Files in Drive will not be deleted.")) return;
    setLinkingFolder(true); setFolderError("");
    try { const r = (await base44.functions.invoke("job-documents", { action: "unlink_folder", job_id: id })).data; if (r?.error) throw Error(r.error); setFolderId(""); await loadAll(); }
    catch (e) { setFolderError(e.message || "Drive folder could not be unlinked."); }
    finally { setLinkingFolder(false); }
  };
  // quiet: a live refresh keeps what is on screen until the new data arrives.
  const loadAll = async ({ quiet = false } = {}) => {
    const version = ++loadVersion.current;
    if (!quiet) {
      setCalEvents([]);
      setEvidence(null);
    }
    const [jb, grp] = await Promise.all([
      base44.entities.Jobs.get(id),
      loadJobGroup(id),
    ]);
    if (version !== loadVersion.current) return;
    // Duplicate records of this job (same customer and address) are read together.
    const memberIds = [id, ...grp.memberIds.filter((m) => m !== id)];
    const { rows: fl, notes: nt } = await loadJobActivity(memberIds);
    if (version !== loadVersion.current) return;
    setJob(jb);
    setGroup(grp);
    setRows(fl);
    setNotes(nt);

    const [allCal, legacyNames] = await Promise.all([
      fetchAllPages(base44.entities.CalendarEvents, "-event_date", 5000),
      loadUniqueLegacyNames(memberIds).catch(() => []),
    ]);
    if (version === loadVersion.current) {
      const shown = jobEventsAndEvidence(allCal, memberIds, fl, nt, legacyNames);
      setCalEvents(shown.events);
      setEvidence(shown.evidence);
    }

    const postIds = new Set(fl.map((r) => r.probuild_post_id).filter(Boolean));
    const allReports = await fetchAllPages(base44.entities.FieldReports, "-created_date", 2000);
    if (version === loadVersion.current) setFieldReports(reportsForJob(allReports, memberIds, postIds, legacyNames));

    base44.entities.PlanIntake.list("-created_date", 200)
      .then((all) => {
        if (version !== loadVersion.current) return;
        const linked = all.filter((p) => planMatchesJob(p, jb));
        setPlans(linked);
      })
      .catch(() => {});
  };

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError("");
    (async () => {
      try { await loadAll(); }
      catch (e) {
        // A missing record is "not found"; anything else is a load failure worth retrying.
        if (current && e?.response?.status !== 404) setLoadError(e?.response?.data?.message || e?.message || "Unknown error");
      }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; loadVersion.current++; };
  }, [id]);

  const live = useJobLive(id, {
    scope: () => liveRef.current,
    reloadAll: () => loadAll({ quiet: true }),
    reloadNotes: async () => {
      const { rows: fl, notes: nt } = await loadJobActivity(liveRef.current.memberIds);
      setRows(fl);
      setNotes(nt);
    },
  });

  const status = useMemo(() => jobsStatus(rows, evidence), [rows, evidence]);
  const today = denverDate();
  const snap = useMemo(() => jobSnapshot({ job, events: calEvents, rows, fieldReports, status, today }), [job, calEvents, rows, fieldReports, status, today]);

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
        {loadError ? (
          <>
            <p role="alert" className="text-[14px] break-words" style={{ color: "#A43432" }}>This job could not load. {loadError}</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-3 text-[13px] underline" style={{ color: C.accent }}>Reload</button>
          </>
        ) : (
          <p className="text-[14px]" style={{ color: C.textMuted }}>Job not found.</p>
        )}
        <Link to="/jobs" style={{ color: C.accent }} className="text-[13px] mt-2 inline-block">← Back to Jobs</Link>
      </div>
    );
  }

  const owner = isPurchaseOrderOwner(user);
  const canContacts = jobContacts.phase !== "private";
  const logInteraction = () => {
    setOpenFormKey((k) => k + 1);
    document.getElementById("add-note")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ backgroundColor: SHEET_BG, minHeight: "100vh" }}>
      <div className="job-page px-5 max-[699px]:px-3 pt-5 max-[699px]:pt-4 pb-28 lg:pb-12">
        <div className="max-w-[1080px] mx-auto flex flex-col gap-[18px]">
          <Link to="/jobs" className="inline-flex w-fit items-center gap-1 text-[13px] font-semibold -mb-1 hover:opacity-80" style={{ color: "#3d3322" }}>
            <ArrowLeft className="h-3.5 w-3.5" />Back to jobs
          </Link>
          {loadError && <p role="alert" className="rounded-lg border bg-white p-3 text-[13px] break-words" style={{ color: "#A43432" }}>Some job activity could not load and may be incomplete. {loadError}</p>}

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
            onRename={async (name) => setJob(await renameJob(job, name))}
            extra={owner ? <Link to={`/jobs/${id}/setup`} className={heroLinkClass} style={heroLinkStyle}>Setup sheet</Link> : null}
          />

          <DuplicateJobNotice group={group} currentId={id} />
          <JobFactsCard snap={snap} folder={folder} />
          <JobCostCard jobId={id} />
          <JobHandoffCard jobId={id} />
          <ScopeCard snap={snap} />

          <div id="add-note" className="scroll-mt-4">
            <SheetCard icon={HardHat} tile={TILE.green} title="Visits" sub="notes, reports and calls, newest first" right={<LiveMark live={live} />}>
              <JobActivityFeed
                ledger
                jobId={id}
                events={calEvents}
                rows={rows}
                notes={notes}
                fieldReports={fieldReports}
                files={folder.files}
                live={live}
                currentUser={user?.email || user?.full_name || ""}
                onChanged={() => loadAll({ quiet: true })}
                onPhotoClick={setLightbox}
                openFormKey={openFormKey}
                title="Visits"
                dedupe={snap}
              />
            </SheetCard>
          </div>

          {/* Office tools: contacts, Drive folder link, money, messages. Each hides itself for crew logins. */}
          {canContacts ? (
            <SheetCard icon={Users} tile={TILE.teal} title="Contacts" sub="linked to this job" bodyClassName="">
              <JobFactsRail job={job} jobContacts={jobContacts} plans={plans} events={calEvents} hideDocuments contactsOnly />
            </SheetCard>
          ) : null}
          {canWriteJobDocuments(user) && (
            <SheetCard icon={FolderOpen} tile={TILE.bronze} title="Drive job folder" sub={job.drive_job_folder_id ? "linked" : "not linked"}>
              <p className="m-0 text-[13px]" style={{ color: "#566063" }}>Paste the ID of a verified folder inside Glass Forge Jobs. A matching name alone is not enough. {job.drive_job_folder_id ? "Linking a new folder replaces the current link." : ""}</p>
              <div className="mt-2 flex gap-2">
                <input className="min-w-0 flex-1 rounded-[9px] border p-2 text-[13px]" style={{ borderColor: "#e2dcd1" }} aria-label="Drive folder ID" value={folderId} onChange={(e) => setFolderId(e.target.value)} />
                <button type="button" disabled={linkingFolder || !folderId.trim()} className="rounded-[9px] px-3 text-[13px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#0b3f3b" }} onClick={attachFolder}>{job.drive_job_folder_id ? "Replace folder link" : "Link folder"}</button>
              </div>
              {job.drive_job_folder_id && <button type="button" disabled={linkingFolder} className="mt-2 text-[13px] underline disabled:opacity-50" onClick={unlinkFolder}>Unlink folder</button>}
              {folderError && <p role="alert" className="mt-2 text-[13px] text-red-700">{folderError}</p>}
            </SheetCard>
          )}
          {(owner || isAgentCenterOwner(user)) && (
            <OwnerSection>
              <JobLinkedRecords jobId={id} memberIds={group?.memberIds} sourceQuoteId={job.source_window_quote_id} />
              <JobMoneyPanel jobId={id} memberIds={group?.memberIds} />
              <JobMessageThreads jobId={id} />
            </OwnerSection>
          )}
        </div>
      </div>

      {/* Mobile sticky Add field report action */}
      <div className="lg:hidden fixed left-0 right-0 z-30 px-4 pt-2 pb-3" style={{ bottom: "calc(68px + env(safe-area-inset-bottom))", backgroundColor: SHEET_BG, borderTop: "1px solid #c9b995" }}>
        <button type="button" onClick={() => setShowReport(true)} className="w-full inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-full text-[13px] font-semibold" style={{ backgroundColor: C.accent, color: C.accentDark }}>
          <Camera className="h-4 w-4" />Add field report
        </button>
      </div>

      {showReport && (
        <JobFieldReportModal jobId={id} jobName={job.canonical_name} events={calEvents} onClose={() => setShowReport(false)} onDone={() => { setShowReport(false); loadAll(); }} />
      )}

      {lightbox && <AttachmentViewer src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

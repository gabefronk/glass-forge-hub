import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FolderOpen, HardHat, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { jobsStatus } from "@/lib/jobsSanitize";
import { holdForService } from "@/lib/serviceHold";
import JobFactsRail from "@/components/jobs/JobFactsRail";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import { AttachmentViewer } from "@/components/jobs/FeedImage";
import { fetchAllPages } from "@/lib/pagination";
import { useJobContacts } from "@/hooks/use-job-contacts";
import { loadJobGroup, loadJobActivity, jobEventsAndEvidence, reportsForJob, loadUniqueLegacyNames } from "@/lib/jobGroupData";
import DuplicateJobNotice from "@/components/jobs/DuplicateJobNotice";
import MergedJobBanner from "@/components/jobs/MergedJobBanner";
import CombinedRecordsPanel from "@/components/jobs/CombinedRecordsPanel";
import JobMoneyPanel from "@/components/jobs/JobMoneyPanel";
import JobLinkedRecords from "@/components/jobs/JobLinkedRecords";
import JobMessageThreads from "@/components/jobs/JobMessageThreads";
import OwnerSection from "@/components/jobs/OwnerSection";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { useAuth } from "@/lib/AuthContext";
import { isPurchaseOrderOwner } from "@/lib/purchaseOrderAccess";
import { procurementPath } from "@/lib/procurementRoutes";
import DeleteJobButton from "@/components/jobs/DeleteJobButton";
import { canWriteJobDocuments } from "../../base44/shared/jobDocumentsAccess.mjs";
import { JobHero, SheetCard, LiveMark, TILE, SHEET_BG, heroLinkClass, heroLinkStyle } from "@/components/jobs/JobSheet";
import { jobProgress } from "@/lib/jobStages";
import { buildReports, buildJobHistory } from "@/lib/jobHistory";
import JobReportMenu from "@/components/jobs/JobReportMenu";
import { JOB_REPORT_EMAIL_ENABLED } from "@/lib/jobReportFlag";
import { jobSnapshot } from "@/lib/jobWorkspace";
import { planMatchesJob, renameJob } from "@/lib/jobRename";
import { updateJobAddress } from "@/lib/jobAddress";
import { denverDate } from "../../base44/shared/billingCore.js";
import { useJobFolderFiles } from "@/hooks/use-job-folder-files";
import { useJobLive } from "@/hooks/use-job-live";
import { ServiceMarker, useServiceItems } from "@/components/jobs/ServiceItems";
import PaymentStatusDropdown, { PaymentStatusChip } from "@/components/jobs/JobPaymentStatus";
import JobUpcomingCard from "@/components/jobs/JobUpcomingCard";
import JobCreateEventModal from "@/components/jobs/JobCreateEventModal";
import { isJobCalendarOwner, JOB_CREATE_ENABLED } from "@/lib/jobCalendarShared";
import { useJobUpcoming } from "@/hooks/use-job-upcoming";
import JobHeroMobile from "@/components/jobs/JobHeroMobile";

// Phone width (matches the max-[699px] breakpoint used across the job page).
function useIsPhone() {
  const query = "(max-width: 699px)";
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsPhone(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isPhone;
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPhone = useIsPhone();
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
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [scheduleStage, setScheduleStage] = useState(null);
  const [upcomingKey, setUpcomingKey] = useState(0);
  const upcoming = useJobUpcoming(id, upcomingKey, { enabled: isJobCalendarOwner(user) });
  const loadVersion = useRef(0);
  const folder = useJobFolderFiles(job);
  // Service items on this job and its duplicate records: shown on their field report in History.
  const service = useServiceItems([id, ...(group?.memberIds || [])]);
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

  // Open service item: the job is never "Complete" until it's fixed.
  const status = useMemo(() => holdForService(jobsStatus(rows, evidence), service.open.length), [rows, evidence, service.open.length]);
  const today = denverDate();
  const snap = useMemo(() => jobSnapshot({ job, events: calEvents, rows, fieldReports, status, today }), [job, calEvents, rows, fieldReports, status, today]);
  const progress = useMemo(() => jobProgress({ events: calEvents, reports: buildReports(rows, fieldReports), status, today }), [calEvents, rows, fieldReports, status, today]);
  const reportEntries = useMemo(
    () => (JOB_REPORT_EMAIL_ENABLED ? buildJobHistory({ events: calEvents, rows, notes, fieldReports, files: folder.files }) : []),
    [calEvents, rows, notes, fieldReports, folder.files]
  );

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

  return (
    <div style={{ backgroundColor: SHEET_BG, minHeight: "100vh" }}>
      <div className="job-page px-5 max-[699px]:px-3 pt-5 max-[699px]:pt-4 pb-28 lg:pb-12">
        <div className="max-w-[1080px] mx-auto flex flex-col gap-[18px]">
          {!isPhone ? (
          <Link to="/jobs" className="inline-flex w-fit items-center gap-1 text-[13px] font-semibold -mb-1 hover:opacity-80" style={{ color: "#3d3322" }}>
            <ArrowLeft className="h-3.5 w-3.5" />Back to jobs
          </Link>
          ) : null}

          {isPhone ? (
            <div className="-mx-3" style={{ marginTop: "calc(-16px - env(safe-area-inset-top, 0px))" }}>
              <JobHeroMobile
                job={job}
                status={status}
                snap={snap}
                jobContacts={jobContacts}
                events={calEvents}
                folder={folder}
                plans={plans}
                upcoming={upcoming}
                alert={<ServiceMarker open={service.open} />}
                onFieldReport={() => setShowReport(true)}
                onRename={async (name) => setJob(await renameJob(job, name))}
                onEditAddress={owner ? async (next) => setJob(await updateJobAddress(job, next)) : null}
                payment={owner
                  ? <PaymentStatusDropdown job={job} plain onChanged={() => loadAll({ quiet: true })} />
                  : (job.payment_status ? <PaymentStatusChip job={job} /> : null)}
                onAddVisit={JOB_CREATE_ENABLED && isJobCalendarOwner(user) ? () => setShowCreateEvent(true) : null}
                setupHref={owner ? `/jobs/${id}/setup` : null}
                budgetHref={owner ? procurementPath(id) : null}
                menuExtra={(JOB_REPORT_EMAIL_ENABLED || owner || isAgentCenterOwner(user)) ? (
                  <>
                    {JOB_REPORT_EMAIL_ENABLED ? <JobReportMenu job={job} entries={reportEntries} tone="hero" /> : null}
                    {(owner || isAgentCenterOwner(user)) ? <DeleteJobButton job={job} onDeleted={() => navigate("/jobs")} className={`${heroLinkClass} w-full justify-center`} style={{ backgroundColor: "rgba(164,52,50,.16)", color: "#f1b9b3", border: "1px solid rgba(241,185,179,.3)" }} /> : null}
                  </>
                ) : null}
              />
            </div>
          ) : null}

          {loadError && <p role="alert" className="rounded-lg border bg-white p-3 text-[13px] break-words" style={{ color: "#A43432" }}>Some job activity could not load and may be incomplete. {loadError}</p>}

          {!isPhone ? (
          <JobHero
            job={job}
            status={status}
            snap={snap}
            jobContacts={jobContacts}
            events={calEvents}
            folder={folder}
            plans={plans}
            onFieldReport={() => setShowReport(true)}
            onRename={async (name) => setJob(await renameJob(job, name))}
            onEditAddress={owner ? async (next) => setJob(await updateJobAddress(job, next)) : null}
            progress={progress}
            alert={<ServiceMarker open={service.open} />}
            upcoming={upcoming}
            payment={owner
              ? <PaymentStatusDropdown job={job} onChanged={() => loadAll({ quiet: true })} />
              : (job.payment_status ? <PaymentStatusChip job={job} /> : null)}
            corner={JOB_REPORT_EMAIL_ENABLED ? <JobReportMenu job={job} entries={reportEntries} tone="hero" /> : null}
            extra={
              <>
                {JOB_CREATE_ENABLED && isJobCalendarOwner(user) ? <button type="button" onClick={() => setShowCreateEvent(true)} className={heroLinkClass} style={heroLinkStyle}>Add visit</button> : null}
                {owner ? <Link to={`/jobs/${id}/setup`} className={heroLinkClass} style={heroLinkStyle}>Setup sheet</Link> : null}
                {owner ? <Link to={procurementPath(id)} className={heroLinkClass} style={heroLinkStyle}>Budget & Orders</Link> : null}
                {(owner || isAgentCenterOwner(user)) ? <DeleteJobButton job={job} onDeleted={() => navigate("/jobs")} className={heroLinkClass} style={{ backgroundColor: "rgba(164,52,50,.16)", color: "#f1b9b3", border: "1px solid rgba(241,185,179,.3)" }} /> : null}
              </>
            }
          />
          ) : null}

          <MergedJobBanner job={job} onReversed={() => loadAll()} />
          <DuplicateJobNotice group={group} currentId={id} />
          {user?.role === "admin" ? <CombinedRecordsPanel job={job} onChanged={() => loadAll({ quiet: true })} /> : null}

          {/* Phone: the next visit lives in the header's Job info dropdown. */}
          {isJobCalendarOwner(user) && !isPhone ? <JobUpcomingCard upcoming={upcoming} /> : null}
          <div id="add-note" className="scroll-mt-4">
            <SheetCard icon={HardHat} tile={TILE.green} title="History" sub="visits, reports and notes, newest first" right={<>{JOB_REPORT_EMAIL_ENABLED ? <JobReportMenu job={job} entries={reportEntries} tone="card" /> : null}<LiveMark live={live} /></>}>
              <JobActivityFeed
                onScheduleNext={(next) => { setScheduleStage(next); setShowCreateEvent(true); }}
                ledger
                jobId={id}
                events={calEvents}
                rows={rows}
                notes={notes}
                fieldReports={fieldReports}
                files={folder.files}
                live={live}
                currentUser={user?.email || user?.full_name || ""}
                authUser={user}
                onChanged={() => loadAll({ quiet: true })}
                onPhotoClick={(src, photos) => setLightbox({ src, photos })}
                title="History"
                dedupe={snap}
                progress={progress}
                serviceItems={service.items}
                onServiceChanged={service.reload}
              />
            </SheetCard>
          </div>

          {/* Office tools: contacts, Drive folder link, money, messages. Each hides itself for crew logins.
              10/22 mobile pass: these three are redundant on the phone - contacts and
              budgeting live in the hero links at top, and Drive files arrive with the
              report PDFs - so they stay desktop-only. */}
          {canContacts ? (
            <div className="max-[699px]:hidden">
              <SheetCard icon={Users} tile={TILE.teal} title="Contacts" sub="linked to this job" bodyClassName="">
                <JobFactsRail job={job} jobContacts={jobContacts} plans={plans} events={calEvents} hideDocuments contactsOnly />
              </SheetCard>
            </div>
          ) : null}
          {canWriteJobDocuments(user) && (
            <div className="max-[699px]:hidden">
            <SheetCard icon={FolderOpen} tile={TILE.bronze} title="Drive job folder" sub={job.drive_job_folder_id ? "linked" : "not linked"}>
              <p className="m-0 text-[13px]" style={{ color: "#566063" }}>Paste the ID of a verified folder inside Glass Forge Jobs. A matching name alone is not enough. {job.drive_job_folder_id ? "Linking a new folder replaces the current link." : ""}</p>
              <div className="mt-2 flex gap-2">
                <input className="min-w-0 flex-1 rounded-[9px] border p-2 text-[13px]" style={{ borderColor: "#e2dcd1" }} aria-label="Drive folder ID" value={folderId} onChange={(e) => setFolderId(e.target.value)} />
                <button type="button" disabled={linkingFolder || !folderId.trim()} className="rounded-[9px] px-3 text-[13px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#0b3f3b" }} onClick={attachFolder}>{job.drive_job_folder_id ? "Replace folder link" : "Link folder"}</button>
              </div>
              {job.drive_job_folder_id && <button type="button" disabled={linkingFolder} className="mt-2 text-[13px] underline disabled:opacity-50" onClick={unlinkFolder}>Unlink folder</button>}
              {folderError && <p role="alert" className="mt-2 text-[13px] text-red-700">{folderError}</p>}
            </SheetCard>
            </div>
          )}
          {(owner || isAgentCenterOwner(user)) && (
            <div className="max-[699px]:hidden">
            <OwnerSection>
              <JobLinkedRecords jobId={id} memberIds={group?.memberIds} sourceQuoteId={job.source_window_quote_id} />
              <JobMoneyPanel jobId={id} memberIds={group?.memberIds} />
              <JobMessageThreads jobId={id} />
            </OwnerSection>
            </div>
          )}
        </div>
      </div>

      {showReport && (
        <JobFieldReportModal jobId={id} jobName={job.canonical_name} events={calEvents} onClose={() => setShowReport(false)} onDone={() => { setShowReport(false); service.reload(); loadAll(); }} />
      )}


      {showCreateEvent && isJobCalendarOwner(user) ? (
        <JobCreateEventModal job={job} user={user} open={showCreateEvent} prefill={scheduleStage ? { notes: scheduleStage.label, stageLabel: scheduleStage.label } : null} onOpenChange={(o) => { setShowCreateEvent(o); if (!o) setScheduleStage(null); }} onCreated={() => setUpcomingKey((k) => k + 1)} />
      ) : null}

      {lightbox && <AttachmentViewer src={lightbox.src} photos={lightbox.photos} onClose={() => setLightbox(null)} onNavigate={(next) => setLightbox((l) => (l ? { ...l, src: next } : l))} />}
    </div>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";
import { titleCase } from "@/lib/displayName";
import { Link } from "react-router-dom";
import { Camera, ArrowUpRight, MapPin, Phone, Navigation, Plus, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { jobsStatus, sanitizeText } from "@/lib/jobsSanitize";
import { fetchAllPages } from "@/lib/pagination";
import { ROLE_LABELS } from "@/lib/jobContacts";
import { useJobContacts } from "@/hooks/use-job-contacts";
import { useJobFolderFiles } from "@/hooks/use-job-folder-files";
import { useJobLive } from "@/hooks/use-job-live";
import { loadJobActivity, jobEventsAndEvidence, reportsForJob, loadUniqueLegacyNames } from "@/lib/jobGroupData";
import { jobSnapshot } from "@/lib/jobWorkspace";
import DuplicateJobNotice from "@/components/jobs/DuplicateJobNotice";
import JobActivityFeed from "@/components/jobs/JobActivityFeed";
import JobFieldReportModal from "@/components/jobs/JobFieldReportModal";
import JobPlansPhotos from "@/components/jobs/JobPlansPhotos";
import { AttachmentViewer } from "@/components/jobs/FeedImage";
import { denverDate } from "../../../base44/shared/billingCore.js";

const INK = "#101617", MUTED = "#566063", TEAL = "#0b3f3b", SAND = "#f4f1ea", SOFT = "#f8f6f1";
const STEP_TONES = {
  teal: ["#e2eeeb", TEAL],
  neutral: ["#eef1f3", "#34506a"],
  warn: ["#faf0da", "#8a5a12"],
  bad: ["#fcedec", "#a43432"],
};

const telHref = (c) => `tel:${c.phone_key || String(c.phone || "").replace(/[^\d+]/g, "")}`;


// Right side of the desktop Jobs workspace: what the installer or super needs
// to act (next step, call, directions, facts, plans & photos), then the live
// job history. `group` is the read-only duplicate group from lib/jobDedupe.js;
// activity of every member record is shown.
export default function JobWorkspacePanel({ jobId, group = null }) {
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
  const [showScope, setShowScope] = useState(false);
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
          setPlans(all.filter((p) =>
            (jb.source_window_quote_id && p.quote_id === jb.source_window_quote_id) ||
            (p.job_name && jb.canonical_name && p.job_name.toLowerCase() === jb.canonical_name.toLowerCase())
          ));
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
  const contactView = jobContacts.view?.job?.id === jobId ? jobContacts.view : null;
  const linked = contactView?.linked || [];
  const missingSuper = Boolean(contactView?.status?.missing_superintendent);
  const mapHref = job?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null;

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

  const [stepBg, stepInk] = STEP_TONES[snap.step.tone] || STEP_TONES.neutral;
  const ROLE_RANK = ["superintendent", "project_manager", "site", "customer", "homeowner", "builder"];
  const sortedContacts = [...linked].sort((a, b) => (ROLE_RANK.indexOf(a.role) + 99) % 99 - (ROLE_RANK.indexOf(b.role) + 99) % 99);
  const visitFact = snap.facts[0];
  const ROLE_SHORT = { superintendent: "Super", project_manager: "PM", site: "Site", customer: "Customer", homeowner: "Owner", builder: "Builder" };
  const smallBtn = "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-semibold whitespace-nowrap";
  const pos = snap.refs.filter((r) => r.startsWith("PO ")).map((r) => r.slice(3));
  const oes = snap.refs.filter((r) => r.startsWith("OE ")).map((r) => r.slice(3));
  const strip = [
    [visitFact.k, <span style={{ color: visitFact.tone === "teal" ? TEAL : INK }}>{visitFact.v}</span>],
    ["Crew", snap.facts[1].v],
    ["PO", <span className="font-mono text-[13px]" title={pos.join(", ")}>{pos.length ? pos[0] + (pos.length > 1 ? ` +${pos.length - 1}` : "") : "—"}</span>],
    ["OE", <span className="font-mono text-[13px]" title={oes.join(", ")}>{oes.length ? oes[0] + (oes.length > 1 ? ` +${oes.length - 1}` : "") : "—"}</span>],
    ["Job folder", folder.folder?.url ? <a href={folder.folder.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: TEAL }}>Open in Drive</a> : <span style={{ color: MUTED }}>Not linked</span>],
  ];

  const logInteraction = () => {
    setOpenFormKey((k) => k + 1);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto obsidian-scroll">
      <div className="px-7 pt-6 pb-10 flex flex-col gap-4 max-[1400px]:px-5">
        {/* Who and where: two lines */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[24px] font-extrabold leading-[1.15] break-words" style={{ color: INK, letterSpacing: "-0.03em" }}>{titleCase(sanitizeText(job.canonical_name))}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px]" style={{ color: MUTED }}>
              {[sanitizeText(job.builder || ""), snap.kind].filter(Boolean).map((t, i) => <span key={i}>{i ? "· " : ""}{t}</span>)}
              {job.address && (
                <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline" style={{ color: "#34403f" }}>
                  {job.builder || snap.kind ? <span style={{ color: MUTED }}>·</span> : null}
                  <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: TEAL }} />{sanitizeText(job.address)}
                </a>
              )}
            </div>
          </div>
          <span className="shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>{status.label}</span>
        </div>

        {/* Next step + actions on one row */}
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] py-2 pl-3 pr-2" style={{ backgroundColor: stepBg }}>
          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap" style={{ color: stepInk }}>{snap.step.tag}</span>
          <span className="min-w-0 flex-1 text-[14px] font-semibold leading-[20px]" style={{ color: INK }}>{snap.step.text}</span>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setShowReport(true)} className={`${smallBtn} text-white`} style={{ backgroundColor: TEAL }}>
              <Camera className="h-3.5 w-3.5" />Field report
            </button>
            {mapHref ? <a href={mapHref} target="_blank" rel="noreferrer" className={smallBtn} style={{ backgroundColor: "#fff", color: INK }}><Navigation className="h-3.5 w-3.5" style={{ color: TEAL }} />Directions</a> : null}
            <button type="button" onClick={logInteraction} className={smallBtn} style={{ backgroundColor: "#fff", color: INK }}><Plus className="h-3.5 w-3.5" style={{ color: TEAL }} />Log</button>
            <Link to={`/jobs/${jobId}`} className={smallBtn} style={{ color: TEAL }} title="Open the full job page">Full page<ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
        </div>

        {/* Job facts in one strip */}
        <dl className="m-0 grid grid-cols-5 overflow-hidden rounded-[12px] max-[1300px]:grid-cols-3" style={{ backgroundColor: SOFT }}>
          {strip.map(([k, v]) => (
            <div key={k} className="min-w-0 px-3 py-2">
              <dt className="text-[11.5px] font-medium" style={{ color: MUTED }}>{k}</dt>
              <dd className="m-0 truncate text-[13.5px] font-semibold" style={{ color: INK }}>{v}</dd>
            </div>
          ))}
        </dl>

        {/* Contacts: one row of call buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12.5px] font-bold" style={{ color: MUTED }}>Contacts</span>
          {sortedContacts.map((c) => {
            const label = <><span className="font-semibold" style={{ color: INK }}>{sanitizeText(c.name || "Unknown")}</span><span style={{ color: MUTED }}>{ROLE_SHORT[c.role] || ROLE_LABELS[c.role] || "Contact"}</span></>;
            return c.phone ? (
              <a key={c.key || c.id || c.name} href={telHref(c)} title={`Call ${sanitizeText(c.name || "")} · ${c.phone}`} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] hover:shadow-sm" style={{ backgroundColor: SAND }}>
                <Phone className="h-3 w-3" style={{ color: TEAL }} />{label}<span className="font-medium" style={{ color: TEAL }}>{c.phone}</span>
              </a>
            ) : (
              <span key={c.key || c.id || c.name} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px]" style={{ backgroundColor: SAND }}>{label}</span>
            );
          })}
          {!linked.length ? <span className="text-[12.5px]" style={{ color: MUTED }}>None linked yet</span> : null}
          {missingSuper && (
            <Link to={`/jobs/${jobId}`} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ backgroundColor: "#faf0da", color: "#8a5a12" }}>
              <AlertTriangle className="h-3 w-3 shrink-0" />{contactView.status.missing_contact ? "Add contacts" : "Add super"}
            </Link>
          )}
        </div>

        {/* Scope: two lines until opened */}
        {snap.work.length ? (
          <div className="text-[13.5px] leading-[20px]" style={{ color: INK }}>
            <span className="mr-1.5 text-[12.5px] font-bold" style={{ color: MUTED }}>Scope{snap.workFrom ? ` · ${snap.workFrom}` : ""}</span>
            <span className={showScope ? "" : "line-clamp-2"}>{snap.work.map((w) => sanitizeText(w)).join("  ·  ")}</span>
            {snap.work.length > 2 ? (
              <button type="button" onClick={() => setShowScope((v) => !v)} className="ml-1 text-[12.5px] font-semibold hover:underline" style={{ color: TEAL }}>{showScope ? "Show less" : "Show all"}</button>
            ) : null}
          </div>
        ) : null}

        <DuplicateJobNotice group={group} currentId={jobId} />

        <JobPlansPhotos bare showPhotos={false} folder={folder} plans={plans} events={calEvents} sitePhotos={[]} onPhotoClick={setLightbox} />

        {/* Visits, each with its own photos and notes, newest first */}
        <div ref={historyRef} className="scroll-mt-4 border-t pt-5" style={{ borderColor: "#efebe3" }}>
          <JobActivityFeed
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
            title="Site visits & history"
          />
        </div>
      </div>

      {showReport && (
        <JobFieldReportModal jobId={jobId} jobName={job.canonical_name} events={calEvents} onClose={() => setShowReport(false)} onDone={() => { setShowReport(false); load({ quiet: true }); }} />
      )}

      {lightbox && <AttachmentViewer src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

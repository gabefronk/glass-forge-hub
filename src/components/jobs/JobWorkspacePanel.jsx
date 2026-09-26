import { useEffect, useMemo, useRef, useState } from "react";
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
import { buildJobHistory, recentSitePhotos } from "@/lib/jobHistory";
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

// Superintendent first, then project manager, from the read-only job contacts join.
function pickLead(linked) {
  return linked.find((c) => c.role === "superintendent") || linked.find((c) => c.role === "project_manager") || null;
}
const telHref = (c) => `tel:${c.phone_key || String(c.phone || "").replace(/[^\d+]/g, "")}`;

function SectionTitle({ children, id }) {
  return <h3 id={id} className="m-0 mb-2 text-[13px] font-bold" style={{ color: MUTED }}>{children}</h3>;
}

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
  const sitePhotos = useMemo(
    () => recentSitePhotos(buildJobHistory({ events: calEvents, rows, notes, fieldReports }), 6),
    [calEvents, rows, notes, fieldReports]
  );
  const contactView = jobContacts.view?.job?.id === jobId ? jobContacts.view : null;
  const linked = contactView?.linked || [];
  const lead = pickLead(linked);
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
  const logInteraction = () => {
    setOpenFormKey((k) => k + 1);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const softBtn = "inline-flex items-center gap-2 h-11 px-4 rounded-[12px] text-[14px] font-semibold whitespace-nowrap";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto obsidian-scroll">
      <div className="px-8 pt-7 pb-10 flex flex-col gap-5 max-[1400px]:px-6">
        {/* Who, what, where */}
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium" style={{ color: MUTED }}>
              {[sanitizeText(job.builder || ""), snap.kind].filter(Boolean).join(" · ") || "Job"}
            </div>
            <h2 className="m-0 mt-1 text-[30px] font-extrabold leading-[1.1] break-words" style={{ color: INK, letterSpacing: "-0.04em" }}>{sanitizeText(job.canonical_name)}</h2>
            {job.address && (
              <a href={mapHref} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[15px] font-medium hover:underline" style={{ color: "#34403f" }}>
                <MapPin className="h-4 w-4 shrink-0" style={{ color: TEAL }} />{sanitizeText(job.address)}
              </a>
            )}
          </div>
          <span className="shrink-0 rounded-full px-3 py-1 text-[12.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>{status.label}</span>
        </div>

        {/* Next step */}
        <div className="flex items-center gap-3 rounded-[14px] px-4 py-3.5" style={{ backgroundColor: stepBg }}>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[12px] font-bold whitespace-nowrap" style={{ color: stepInk }}>{snap.step.tag}</span>
          <span className="text-[15.5px] font-semibold leading-[22px] break-words" style={{ color: INK }}>{snap.step.text}</span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => setShowReport(true)} className="inline-flex items-center gap-2 h-11 px-5 rounded-[12px] text-[14.5px] font-bold text-white whitespace-nowrap" style={{ backgroundColor: TEAL }}>
            <Camera className="h-4 w-4" />Add field report
          </button>
          {lead?.phone ? (
            <a href={telHref(lead)} className={softBtn} style={{ backgroundColor: SAND, color: INK }} title={`${sanitizeText(lead.name)} · ${lead.phone}`}>
              <Phone className="h-4 w-4" style={{ color: TEAL }} />Call {sanitizeText(String(lead.name || "").split(" ")[0] || "super")}
            </a>
          ) : null}
          {mapHref ? (
            <a href={mapHref} target="_blank" rel="noreferrer" className={softBtn} style={{ backgroundColor: SAND, color: INK }}>
              <Navigation className="h-4 w-4" style={{ color: TEAL }} />Directions
            </a>
          ) : null}
          <button type="button" onClick={logInteraction} className={softBtn} style={{ backgroundColor: SAND, color: INK }}>
            <Plus className="h-4 w-4" style={{ color: TEAL }} />Log interaction
          </button>
          <Link to={`/jobs/${jobId}`} className={`${softBtn} ml-auto`} style={{ color: TEAL }}>
            Full page <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Four facts */}
        <div className="grid grid-cols-4 gap-2.5 max-[1400px]:grid-cols-2">
          {snap.facts.map((f) => (
            <div key={f.k} className="min-w-0 rounded-[12px] px-3.5 py-3" style={{ backgroundColor: SOFT }}>
              <div className="text-[12px] font-medium" style={{ color: MUTED }}>{f.k}</div>
              <div className={`mt-1 truncate ${f.mono ? "font-mono text-[14px] font-medium" : "text-[15px] font-bold"}`} style={{ color: f.tone === "teal" ? TEAL : INK }} title={f.v}>{f.v}</div>
            </div>
          ))}
        </div>

        <DuplicateJobNotice group={group} currentId={jobId} />

        <JobPlansPhotos bare folder={folder} plans={plans} events={calEvents} sitePhotos={sitePhotos} onPhotoClick={setLightbox} />

        {/* The work + history | people + orders */}
        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-7 max-[1400px]:grid-cols-1">
          <div className="min-w-0 flex flex-col gap-6">
            <section aria-labelledby="work-heading">
              <SectionTitle id="work-heading">The work{snap.workFrom ? <span className="font-medium"> · {snap.workFrom}</span> : null}</SectionTitle>
              {snap.work.length ? (
                <ul className="m-0 p-0 list-none flex flex-col gap-2">
                  {snap.work.map((w, i) => (
                    <li key={i} className="flex gap-2.5 text-[15.5px] leading-[23px] font-medium" style={{ color: INK }}>
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "#b8955a" }} />
                      <span className="break-words">{sanitizeText(w)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[14px]" style={{ color: MUTED }}>No scope written down yet. Log it with “Log interaction” below.</p>
              )}
            </section>
            <div ref={historyRef} className="scroll-mt-4">
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
              />
            </div>
          </div>

          <aside className="min-w-0 flex flex-col gap-6">
            <section aria-labelledby="people-heading">
              <SectionTitle id="people-heading">People</SectionTitle>
              {linked.length ? linked.slice(0, 6).map((c) => (
                <div key={c.key || c.id || c.name} className="flex items-center gap-2.5 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ backgroundColor: "#e2eeeb", color: "#082f2c" }}>{String(c.name || "?").charAt(0).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold" style={{ color: INK }}>{sanitizeText(c.name || "Unknown")}</div>
                    <div className="text-[12.5px]" style={{ color: MUTED }}>{ROLE_LABELS[c.role] || c.role || "Contact"}</div>
                  </div>
                  {c.phone ? <a href={telHref(c)} className="text-[13px] font-medium whitespace-nowrap hover:underline" style={{ color: TEAL }}>{c.phone}</a> : null}
                </div>
              )) : <p className="m-0 text-[13.5px]" style={{ color: MUTED }}>No contacts linked yet.</p>}
              {missingSuper && (
                <Link to={`/jobs/${jobId}`} className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium" style={{ backgroundColor: "#faf0da", color: "#8a5a12" }}>
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {contactView.status.missing_contact ? "Add contacts" : "No super linked"}
                  {contactView.status.suggestions > 0 ? ` · ${contactView.status.suggestions} suggested` : ""}
                </Link>
              )}
            </section>
            <section aria-labelledby="orders-heading">
              <SectionTitle id="orders-heading">Orders</SectionTitle>
              {snap.refs.length ? snap.refs.map((r) => (
                <div key={r} className="font-mono text-[12.5px] leading-[22px]" style={{ color: "#34403f" }}>{r}</div>
              )) : <p className="m-0 text-[13.5px]" style={{ color: MUTED }}>No PO or OE yet.</p>}
            </section>
          </aside>
        </div>
      </div>

      {showReport && (
        <JobFieldReportModal jobId={jobId} jobName={job.canonical_name} events={calEvents} onClose={() => setShowReport(false)} onDone={() => { setShowReport(false); load({ quiet: true }); }} />
      )}

      {lightbox && <AttachmentViewer src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

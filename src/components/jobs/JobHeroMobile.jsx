import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Camera, CalendarPlus, ChevronDown, ClipboardCheck, DollarSign, MessageSquare, MoreHorizontal, Pencil, Phone } from "lucide-react";
import { sanitizeText } from "@/lib/jobsSanitize";
import { titleCase } from "@/lib/displayName";
import { useJobHomeowner } from "@/hooks/use-job-homeowner";
import { pickHomeowner } from "../../../base44/shared/jobHomeowner.js";
import { nextVisitProjection } from "@/lib/jobCalendarShared";
import { paymentStage } from "@/lib/jobPayment";
import { FilesMenu, HomeownerBox, JobAddress, SuperBox } from "@/components/jobs/JobSheet";

// Phone-only job header (10/23 redesign, "Final" on the Job Header canvas):
// name + status, Field report / Call / Text, one "Job info" dropdown that holds
// address, payment, next visit, refs and the super/homeowner cards, then the
// Files / Add visit / Setup / Budget tiles. Desktop keeps JobHero untouched.
// Same data and the same owner gates as JobHero: the page passes null for
// anything this login may not use.

const HERO = "#0f2a2c", CARD = "#1a3537", LINE = "#2e4c4c";
const INK = "#f2eee8", MUTED = "#a9bdb9", LABEL = "#8fa8a6", BRASS = "#b8955a", BRASS_LT = "#e0c994", MINT = "#cfe3d9";
const digits = (v) => String(v || "").replace(/[^\d+]/g, "");

function Row({ label, children }) {
  return (
    <div className="flex min-h-[38px] items-center justify-between gap-3 text-[13px]">
      <span className="shrink-0" style={{ color: LABEL }}>{label}</span>
      <span className="min-w-0 text-right" style={{ color: INK }}>{children}</span>
    </div>
  );
}

function Tile({ icon: Icon, label, to, onClick }) {
  const cls = "flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-[12px] text-[12px] font-semibold";
  const style = { backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK };
  const inner = <><Icon className="h-[18px] w-[18px]" style={{ color: BRASS_LT }} /><span>{label}</span></>;
  return to
    ? <Link to={to} className={cls} style={style}>{inner}</Link>
    : <button type="button" onClick={onClick} className={cls} style={style}>{inner}</button>;
}

function MoreMenu({ onRename, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!onRename && !children) return null;
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-label="More job options" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} className="flex h-11 w-10 items-center justify-center" style={{ color: INK }}>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-40 flex w-[230px] flex-col gap-1.5 rounded-[12px] p-2" style={{ backgroundColor: HERO, border: `1px solid ${LINE}`, boxShadow: "0 18px 40px -12px rgba(0,0,0,.55)" }}>
          {onRename ? (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename(); }} className="flex min-h-11 items-center gap-2 rounded-[9px] px-3 text-left text-[13.5px] font-semibold" style={{ color: INK, backgroundColor: "rgba(255,255,255,.06)" }}>
              <Pencil className="h-4 w-4" style={{ color: BRASS_LT }} />Rename job
            </button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default function JobHeroMobile({
  job, status, snap, jobContacts, events, folder, plans, upcoming = null,
  alert = null, payment = null, onFieldReport, onRename = null, onEditAddress = null,
  onAddVisit = null, setupHref = null, budgetHref = null, menuExtra = null,
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  useEffect(() => { setInfoOpen(false); setRenaming(false); }, [job?.id]);

  const homeowner = useJobHomeowner(job?.id);
  const view = jobContacts?.view?.job?.id === job?.id ? jobContacts.view : null;
  const owner = useMemo(() => pickHomeowner({ saved: homeowner.saved, view, job }), [homeowner.saved, view, job]);
  const phone = owner?.phone ? digits(owner.phone) : "";

  const proj = useMemo(() => (upcoming?.events?.length ? nextVisitProjection(upcoming.events) : null), [upcoming]);
  const name = titleCase(sanitizeText(job.canonical_name));
  const kind = snap?.kind ? titleCase(String(snap.kind)) : "";
  const city = String(job.address || "").split(",")[1]?.trim() || "";
  const pay = paymentStage(job?.payment_status)?.label || "";
  const summary = [city, pay].filter(Boolean).join(" · ");
  const pos = (snap?.refs || []).filter((r) => r.startsWith("PO ")).map((r) => r.slice(3));
  const oes = (snap?.refs || []).filter((r) => r.startsWith("OE ")).map((r) => r.slice(3));
  const crew = snap?.facts?.[1]?.v;

  const startRename = () => { setNameDraft(job.canonical_name || ""); setNameError(""); setRenaming(true); };
  const saveName = async () => {
    if (savingName) return;
    const next = nameDraft.replace(/\s+/g, " ").trim();
    if (!next || next === job.canonical_name) { setRenaming(false); return; }
    setSavingName(true); setNameError("");
    try { await onRename(next); setRenaming(false); }
    catch (e) { setNameError(e.message || "Could not rename."); }
    finally { setSavingName(false); }
  };

  const tiles = [
    { key: "visit", show: !!onAddVisit, el: <Tile icon={CalendarPlus} label="Add visit" onClick={onAddVisit} /> },
    { key: "setup", show: !!setupHref, el: <Tile icon={ClipboardCheck} label="Setup" to={setupHref} /> },
    { key: "budget", show: !!budgetHref, el: <Tile icon={DollarSign} label="Budget" to={budgetHref} /> },
  ].filter((t) => t.show);
  const cols = tiles.length + 1;

  return (
    <section className="relative z-[3] flex flex-col gap-3 rounded-b-[18px] px-3.5 pb-3.5 pt-2" style={{ backgroundColor: HERO }}>
      {/* Top line: back, name + status, more menu */}
      <div className="flex items-center gap-0.5">
        <Link to="/jobs" aria-label="Back to jobs" className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center" style={{ color: INK }}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1.5 py-1">
              <input autoFocus aria-label="Job name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); } if (e.key === "Escape") setRenaming(false); }}
                className="h-10 min-w-0 flex-1 rounded-[9px] px-2.5 text-[16px] font-bold outline-none"
                style={{ backgroundColor: "rgba(255,255,255,.08)", color: INK, border: "1px solid rgba(224,201,148,.45)" }} />
              <button type="button" onClick={saveName} disabled={savingName} className="h-10 rounded-[9px] px-3 text-[13px] font-semibold disabled:opacity-60" style={{ backgroundColor: MINT, color: HERO }}>{savingName ? "…" : "Save"}</button>
              <button type="button" onClick={() => setRenaming(false)} className="h-10 px-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>Cancel</button>
            </div>
          ) : (
            <>
              <h1 className="m-0 truncate text-[19px] font-extrabold leading-[24px]" style={{ color: INK, letterSpacing: "-0.01em" }}>{name}</h1>
              <div className="flex min-w-0 items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
                {alert}
                <span className="truncate">{kind ? `${kind} · ` : ""}<span className="font-semibold" style={{ color: BRASS_LT }}>{status?.label}</span></span>
              </div>
            </>
          )}
          {nameError ? <p role="alert" className="m-0 text-[12px]" style={{ color: "#f1b9b3" }}>{nameError}</p> : null}
        </div>
        <MoreMenu onRename={onRename ? startRename : null}>{menuExtra}</MoreMenu>
      </div>

      {/* Field report + call / text the homeowner */}
      <div className="flex gap-2">
        <button type="button" onClick={onFieldReport} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] text-[15px] font-bold" style={{ backgroundColor: BRASS, color: "#1a1a16" }}>
          <Camera className="h-[18px] w-[18px]" />Field report
        </button>
        {phone ? (
          <>
            <a href={`tel:${phone}`} aria-label={`Call ${sanitizeText(owner.name || "homeowner")}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]" style={{ backgroundColor: MINT, color: HERO }}><Phone className="h-[18px] w-[18px]" /></a>
            <a href={`sms:${phone}`} aria-label={`Text ${sanitizeText(owner.name || "homeowner")}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]" style={{ backgroundColor: "#1e3a3b", color: INK }}><MessageSquare className="h-[18px] w-[18px]" /></a>
          </>
        ) : null}
      </div>

      {/* Job info dropdown */}
      <div className="flex flex-col rounded-[12px]" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
        <button type="button" aria-expanded={infoOpen} onClick={() => setInfoOpen((v) => !v)} className="flex h-11 items-center gap-2 px-3 text-left">
          <span className="flex-1 text-[14px] font-semibold" style={{ color: INK }}>Job info</span>
          {summary ? <span className="min-w-0 truncate text-[12px]" style={{ color: MUTED }}>{summary}</span> : null}
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${infoOpen ? "rotate-180" : ""}`} style={{ color: infoOpen ? BRASS_LT : MUTED }} />
        </button>
        {infoOpen ? (
          <div className="flex flex-col gap-1 px-3 pb-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <div className="-mt-1"><JobAddress job={job} onEditAddress={onEditAddress} /></div>
            {payment ? <Row label="Payment">{payment}</Row> : null}
            <Row label="Next visit">
              {proj
                ? <span><span className="font-semibold">{proj.line}</span>{proj.purposePreview ? <span className="block text-[12px]" style={{ color: MUTED }}>{proj.purposePreview}</span> : null}</span>
                : <span>{snap?.step?.tag ? <span className="font-semibold">{snap.step.tag}</span> : "—"}</span>}
            </Row>
            {pos.length ? <Row label="PO"><span className="font-mono text-[12.5px]">{pos.join(", ")}</span></Row> : null}
            {oes.length ? <Row label="OE"><span className="font-mono text-[12.5px]">{oes.join(", ")}</span></Row> : null}
            {crew && crew !== "—" ? <Row label="Crew">{crew}</Row> : null}
            {folder?.folder?.url ? <Row label="Job folder"><a href={folder.folder.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: BRASS_LT }}>Open in Drive</a></Row> : null}
            <div className="mt-2 flex flex-col gap-2">
              <SuperBox jobId={job.id} jobContacts={jobContacts} events={events} />
              <HomeownerBox job={job} jobContacts={jobContacts} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Tools */}
      <nav aria-label="Job tools" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        <FilesMenu folder={folder} plans={plans} events={events} tile />
        {tiles.map((t) => <div key={t.key}>{t.el}</div>)}
      </nav>
    </section>
  );
}

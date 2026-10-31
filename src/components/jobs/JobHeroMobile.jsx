import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Camera, CalendarPlus, ChevronDown, ClipboardCheck, DollarSign, MessageSquare, MoreHorizontal, Pencil, Phone } from "lucide-react";
import { sanitizeText } from "@/lib/jobsSanitize";
import { titleCase } from "@/lib/displayName";
import { useJobHomeowner } from "@/hooks/use-job-homeowner";
import { useJobSuper } from "@/hooks/use-job-super";
import { pickHomeowner } from "../../../base44/shared/jobHomeowner.js";
import { pickSuper } from "@/lib/jobWorkspace";
import { nextVisitProjection } from "@/lib/jobCalendarShared";
import { paymentStage } from "@/lib/jobPayment";
import { FilesMenu, HomeownerBox, SuperBox } from "@/components/jobs/JobSheet";

// Phone-only job header (10/23 redesign, "Final" on the Job Header canvas):
// name + status, Field report / Call / Text, one "Job info" dropdown of tidy
// label/value rows, then the Files / Add visit / Setup / Budget tiles.
// Desktop keeps JobHero untouched. Same data and owner gates as JobHero: the
// page passes null for anything this login may not use.

const HERO = "#0f2a2c", CARD = "#1a3537", LINE = "#2a4646";
const INK = "#f2eee8", MUTED = "#a9bdb9", LABEL = "#8fa8a6", BRASS = "#b8955a", BRASS_LT = "#e0c994", MINT = "#cfe3d9";
const digits = (v) => String(v || "").replace(/[^\d+]/g, "");
const SAFE_TOP = "env(safe-area-inset-top, 0px)";

// One label/value line. `action` is a small trailing text button (Edit / Add).
function Row({ label, children, action = null, sub = null, first = false }) {
  return (
    <div className="py-2.5" style={first ? null : { borderTop: `1px solid ${LINE}` }}>
      <div className="flex min-h-[24px] items-center gap-3">
        <span className="w-[86px] shrink-0 text-[13px]" style={{ color: LABEL }}>{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[14px] font-medium" style={{ color: INK }}>{children}</span>
        {action}
      </div>
      {sub ? <div className="mt-1 text-[12.5px] leading-[1.4]" style={{ color: MUTED }}>{sub}</div> : null}
    </div>
  );
}

function SmallAction({ onClick, children, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="-my-2 -mr-1 shrink-0 px-1 text-[13px] font-semibold" style={{ color: BRASS_LT, minHeight: 40 }}>{children}</button>
  );
}

function Tile({ icon: Icon, label, to, onClick }) {
  const cls = "flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-[12px] text-[12px] font-semibold";
  const style = { backgroundColor: CARD, border: `1px solid #2e4c4c`, color: INK };
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
        <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-40 flex w-[230px] flex-col gap-1.5 rounded-[12px] p-2" style={{ backgroundColor: HERO, border: `1px solid #2e4c4c`, boxShadow: "0 18px 40px -12px rgba(0,0,0,.55)" }}>
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

// Inline one-field editor used for the job name and the address.
function InlineEdit({ value, onSave, onCancel, label, big = false }) {
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (saving) return;
    const next = draft.replace(/\s+/g, " ").trim();
    if (next === (value || "")) { onCancel(); return; }
    setSaving(true); setError("");
    try { await onSave(next); onCancel(); }
    catch (e) { setError(e.message || "Could not save."); setSaving(false); }
  };
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5">
        <input autoFocus aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") onCancel(); }}
          className={`h-11 min-w-0 flex-1 rounded-[9px] px-2.5 outline-none ${big ? "font-bold" : ""}`}
          style={{ backgroundColor: "rgba(255,255,255,.08)", color: INK, border: "1px solid rgba(224,201,148,.45)" }} />
        <button type="button" onClick={save} disabled={saving} className="h-11 rounded-[9px] px-3 text-[13px] font-semibold disabled:opacity-60" style={{ backgroundColor: MINT, color: HERO }}>{saving ? "…" : "Save"}</button>
        <button type="button" onClick={onCancel} className="h-11 px-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>Cancel</button>
      </div>
      {error ? <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
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
  const [editingAddress, setEditingAddress] = useState(false);
  const [contactOpen, setContactOpen] = useState(null); // "super" | "homeowner" | null
  useEffect(() => { setInfoOpen(false); setRenaming(false); setEditingAddress(false); setContactOpen(null); }, [job?.id]);

  // iPhone: paint the status-bar area dark while this header is showing.
  useEffect(() => {
    let meta = document.querySelector('meta[name="theme-color"]');
    const created = !meta;
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    const prev = meta.content;
    meta.content = HERO;
    return () => { if (created) meta.remove(); else meta.content = prev; };
  }, []);

  const view = jobContacts?.view?.job?.id === job?.id ? jobContacts.view : null;
  const homeowner = useJobHomeowner(job?.id);
  const owner = useMemo(() => pickHomeowner({ saved: homeowner.saved, view, job }), [homeowner.saved, view, job]);
  const jobSuper = useJobSuper(job?.id);
  const sup = useMemo(() => pickSuper({ saved: jobSuper.saved, view, events }), [jobSuper.saved, view, events]);
  const phone = owner?.phone ? digits(owner.phone) : "";

  const proj = useMemo(() => (upcoming?.events?.length ? nextVisitProjection(upcoming.events) : null), [upcoming]);
  const name = titleCase(sanitizeText(job.canonical_name));
  const kind = snap?.kind ? sanitizeText(String(snap.kind)) : "";
  const address = sanitizeText(job.address || "");
  const city = address.split(",")[1]?.trim() || "";
  const pay = paymentStage(job?.payment_status)?.label || "";
  const summary = [city, pay].filter(Boolean).join(" · ");
  const pos = (snap?.refs || []).filter((r) => r.startsWith("PO ")).map((r) => r.slice(3));
  const oes = (snap?.refs || []).filter((r) => r.startsWith("OE ")).map((r) => r.slice(3));
  const crew = snap?.facts?.[1]?.v;
  const dirHref = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;
  const toggleContact = (k) => setContactOpen((v) => (v === k ? null : k));

  const tiles = [
    { key: "visit", show: !!onAddVisit, el: <Tile icon={CalendarPlus} label="Add visit" onClick={onAddVisit} /> },
    { key: "setup", show: !!setupHref, el: <Tile icon={ClipboardCheck} label="Setup" to={setupHref} /> },
    { key: "budget", show: !!budgetHref, el: <Tile icon={DollarSign} label="Budget" to={budgetHref} /> },
  ].filter((t) => t.show);
  const cols = tiles.length + 1;

  return (
    <section className="relative z-[3] flex flex-col gap-3 rounded-b-[18px] px-3.5 pb-3.5" style={{ backgroundColor: HERO, paddingTop: `calc(6px + ${SAFE_TOP})` }}>
      {/* Top line: back, name + status, more menu */}
      <div className="flex items-center gap-0.5">
        <Link to="/jobs" aria-label="Back to jobs" className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center" style={{ color: INK }}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <InlineEdit label="Job name" value={job.canonical_name} big onSave={onRename} onCancel={() => setRenaming(false)} />
          ) : (
            <>
              <h1 className="m-0 truncate text-[19px] font-extrabold leading-[24px]" style={{ color: INK, letterSpacing: "-0.01em" }}>{name}</h1>
              <div className="flex min-w-0 items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
                {alert}
                <span className="truncate">{kind ? `${kind} · ` : ""}<span className="font-semibold" style={{ color: BRASS_LT }}>{status?.label}</span></span>
              </div>
            </>
          )}
        </div>
        <MoreMenu onRename={onRename ? () => setRenaming(true) : null}>{menuExtra}</MoreMenu>
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
      <div className="flex flex-col rounded-[12px]" style={{ backgroundColor: CARD, border: `1px solid #2e4c4c` }}>
        <button type="button" aria-expanded={infoOpen} onClick={() => setInfoOpen((v) => !v)} className="flex h-11 items-center gap-2 px-3 text-left">
          <span className="flex-1 text-[14px] font-semibold" style={{ color: INK }}>Job info</span>
          {summary ? <span className="min-w-0 truncate text-[12px]" style={{ color: MUTED }}>{summary}</span> : null}
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${infoOpen ? "rotate-180" : ""}`} style={{ color: infoOpen ? BRASS_LT : MUTED }} />
        </button>
        {infoOpen ? (
          <div className="px-3 pb-1" style={{ borderTop: `1px solid ${LINE}` }}>
            {editingAddress ? (
              <InlineEdit label="Job address" value={job.address} onSave={onEditAddress} onCancel={() => setEditingAddress(false)} />
            ) : (
              <Row first label="Address" action={onEditAddress ? <SmallAction label={address ? "Edit job address" : "Add job address"} onClick={() => setEditingAddress(true)}>{address ? "Edit" : "Add"}</SmallAction> : null}>
                {address
                  ? <a href={dirHref} target="_blank" rel="noopener noreferrer" style={{ color: INK }}>{address.split(",")[0]}{city ? `, ${city}` : ""}</a>
                  : <span style={{ color: MUTED }}>None on file</span>}
              </Row>
            )}

            {payment ? <Row label="Payment"><span className="inline-flex justify-end">{payment}</span></Row> : null}

            {/* A booked visit is listed in the Upcoming card below, so it isn't repeated here. */}
            {proj ? null : <Row label="Next visit">{snap?.step?.tag || "—"}</Row>}

            {pos.length ? <Row label="PO"><span className="font-mono text-[13px]">{pos.join(", ")}</span></Row> : null}
            {oes.length ? <Row label="OE"><span className="font-mono text-[13px]">{oes.join(", ")}</span></Row> : null}
            {crew && crew !== "—" ? <Row label="Crew">{crew}</Row> : null}
            {job.flashing_method ? (
              <Row label="Flashing"><FlashingGuideLink job={job} color={BRASS_LT} /></Row>
            ) : null}

            <Row label="Homeowner" action={<SmallAction label="Edit homeowner" onClick={() => toggleContact("homeowner")}>{contactOpen === "homeowner" ? "Done" : owner ? "Edit" : "Add"}</SmallAction>}>
              {owner ? <>{sanitizeText(owner.name || "")}{owner.phone ? <span style={{ color: MUTED }}> · {owner.phone}</span> : null}</> : <span style={{ color: MUTED }}>{homeowner.loading ? "Looking…" : "Not on file"}</span>}
            </Row>
            {contactOpen === "homeowner" ? <div className="pb-2.5"><HomeownerBox job={job} jobContacts={jobContacts} /></div> : null}

            <Row label="Super" action={<SmallAction label="Edit super" onClick={() => toggleContact("super")}>{contactOpen === "super" ? "Done" : sup ? "Edit" : "Add"}</SmallAction>}>
              {sup ? <>{sanitizeText(sup.name || "")}{sup.phone ? <span style={{ color: MUTED }}> · {sup.phone}</span> : null}</> : <span style={{ color: MUTED }}>Not on file</span>}
            </Row>
            {contactOpen === "super" ? <div className="pb-2.5"><SuperBox jobId={job.id} jobContacts={jobContacts} events={events} /></div> : null}

            {folder?.folder?.url ? (
              <Row label="Job folder"><a href={folder.folder.url} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: BRASS_LT }}>Open in Drive</a></Row>
            ) : null}
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

import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Camera, ChevronDown, ClipboardCheck, ExternalLink, FileText, MapPin, MessageSquare, Navigation, Phone, Plus, HardHat, UserPlus } from "lucide-react";
import { formatShort } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { titleCase } from "@/lib/displayName";
import { ROLE_LABELS } from "@/lib/jobContacts";
import { pickSuper, parseScopeNotes, scopeIsEmpty } from "@/lib/jobWorkspace";
import ScopeNotes from "@/components/jobs/ScopeNotes";
import { fileBadge, fileLabel } from "@/lib/jobHistory";
import { eventAttachments, isGmailOnly, openAttachment } from "@/components/jobs/JobEventDocuments";
import { useJobSuper } from "@/hooks/use-job-super";

// "Sand & brass" job sheet: a dark hero (name, address, super, next step,
// actions, files) and white section cards with green-haze title bands.
// Every value comes from the connectors the job pages already used.
export const SHEET_BG = "#d9cbb0";
const INK = "#101617", MUTED = "#616a6d", BRASS = "#b8955a", BRASS_LT = "#e0c994", HERO_INK = "#f2eee8", HERO_MUTED = "#aeb5b7";
const CARD_SHADOW = "0 1px 2px rgba(10,29,31,.08),0 6px 14px -6px rgba(10,29,31,.16),0 22px 40px -22px rgba(10,29,31,.34)";
export const TILE = { teal: "#0b3f3b", bronze: "#8a6420", green: "#3b5a3a" };

const digits = (v) => String(v || "").replace(/[^\d+]/g, "");
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
const day = (v) => (v ? formatShort(String(v).slice(0, 10)) : "");

export function SheetCard({ icon: Icon, tile = TILE.teal, title, sub, right, children, className = "", bodyClassName = "px-5 py-4 max-[699px]:px-4" }) {
  return (
    <section className={`rounded-[14px] bg-white ${className}`} style={{ border: "1px solid #d3cabb", boxShadow: CARD_SHADOW }}>
      <div className="flex items-center gap-3 rounded-t-[14px] px-5 py-[11px] max-[699px]:px-4" style={{ background: "linear-gradient(90deg,#cfe3da 0%,#e1eee8 45%,#eef5f1 100%)", borderBottom: "1px solid #bfd6cb" }}>
        {Icon ? <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-white" style={{ backgroundColor: tile }}><Icon className="h-[15px] w-[15px]" /></span> : null}
        <h2 className="m-0 text-[16.5px] font-extrabold" style={{ color: "#082f2c", letterSpacing: "-0.02em" }}>{title}</h2>
        {sub ? <span className="min-w-0 truncate text-[12.5px] font-medium" style={{ color: "#3e5a55" }}>{sub}</span> : null}
        {right ? <span className="ml-auto flex shrink-0 items-center gap-2.5">{right}</span> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function LiveMark({ live }) {
  if (!live) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "#1f6b45" }} title="New notes, reports and visits show up here on their own">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />Live
    </span>
  );
}

// ---------- Super card (lives in the hero) ----------

const FIELD = "h-[34px] w-full min-w-0 rounded-[8px] px-2.5 text-[13.5px] outline-none focus:ring-2";
const FIELD_STYLE = { backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.16)", "--tw-ring-color": "rgba(224,201,148,.5)" };

function SuperForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({ name: initial?.name || "", phone: initial?.phone || "", email: initial?.email || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim() || (!f.phone.trim() && !f.email.trim())) { setError("Add a name and a phone or email."); return; }
    setSaving(true); setError("");
    try { await onSave({ name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() }); }
    catch (err) { setError(err.message || "Could not save."); setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>{initial?.name ? "CHANGE SUPER" : "ADD SUPER"}</div>
      <input autoFocus aria-label="Super name" placeholder="Name" value={f.name} onChange={set("name")} className={FIELD} style={FIELD_STYLE} />
      <input aria-label="Super phone" placeholder="Phone" inputMode="tel" value={f.phone} onChange={set("phone")} className={FIELD} style={FIELD_STYLE} />
      <input aria-label="Super email" placeholder="Email (optional)" inputMode="email" value={f.email} onChange={set("email")} className={FIELD} style={FIELD_STYLE} />
      {error ? <p role="alert" className="m-0 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="inline-flex h-[34px] flex-1 items-center justify-center rounded-[9px] text-[13.5px] font-semibold disabled:opacity-60" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>{saving ? "Saving…" : "Save super"}</button>
        <button type="button" onClick={onCancel} className="inline-flex h-[34px] items-center rounded-[9px] px-3 text-[13.5px] font-semibold" style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" }}>Cancel</button>
      </div>
    </form>
  );
}

function SuperBox({ jobId, jobContacts, events }) {
  const jobSuper = useJobSuper(jobId);
  const view = jobContacts?.view?.job?.id === jobId ? jobContacts.view : null;
  const person = useMemo(() => pickSuper({ saved: jobSuper.saved, view, events }), [jobSuper.saved, view, events]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setError(""); setEditing(false); }, [jobId]);

  const shell = "w-[300px] max-w-full shrink-0 rounded-[12px] p-3.5 pb-3 max-[899px]:w-full";
  const shellStyle = { background: "linear-gradient(150deg,rgba(207,227,218,.16),rgba(207,227,218,.06))", border: "1px solid rgba(207,227,218,.22)" };
  const label = person?.role && person.role !== "superintendent" ? (ROLE_LABELS[person.role] || "Contact").toUpperCase() : "SUPER";
  const save = async (contact) => {
    await jobSuper.save(contact);
    setEditing(false);
    if (jobContacts?.phase && jobContacts.phase !== "private") jobContacts.reload();
  };
  const small = "inline-flex items-center gap-1.5 text-[12.5px] font-semibold hover:underline disabled:opacity-60";

  if (editing) return <div className={shell} style={shellStyle}><SuperForm initial={person?.source === "linked" ? person : person ? { ...person } : null} onSave={save} onCancel={() => setEditing(false)} /></div>;

  if (!person) {
    return (
      <div className={shell} style={shellStyle}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(207,227,218,.18)", color: "#cfe3da" }}><HardHat className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>SUPER</div>
            <div className="text-[14.5px] font-semibold" style={{ color: HERO_MUTED }}>{jobSuper.loading && jobContacts?.phase === "loading" ? "Looking…" : "Not on file yet"}</div>
          </div>
        </div>
        <button type="button" onClick={() => setEditing(true)} className="mt-3 inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[9px] text-[13.5px] font-semibold" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>
          <UserPlus className="h-3.5 w-3.5" />Add super
        </button>
      </div>
    );
  }

  const confirm = async () => {
    setSaving(true); setError("");
    try { await save({ name: person.name, phone: person.phone, email: person.email }); }
    catch (e) { setError(e.message || "Could not save."); }
    finally { setSaving(false); }
  };

  return (
    <div className={shell} style={shellStyle}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>{initials(person.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>
            {label}{person.source === "notes" ? <span style={{ color: "#8f999b" }}> · FROM {person.day ? day(person.day).toUpperCase() : "CALENDAR"} NOTES</span> : person.source === "suggestion" ? <span style={{ color: "#8f999b" }}> · SUGGESTED</span> : null}
          </div>
          <div className="truncate text-[17px] font-bold" style={{ color: HERO_INK, letterSpacing: "-0.01em" }}>{sanitizeText(person.name) || "Unknown"}</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {person.phone ? (
          <a href={`tel:${digits(person.phone)}`} className="inline-flex h-[34px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }} title={`Call ${sanitizeText(person.name)}`}>
            <Phone className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{person.phone}</span>
          </a>
        ) : null}
        {person.phone ? (
          <a href={`sms:${digits(person.phone)}`} className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" }}>
            <MessageSquare className="h-3.5 w-3.5" style={{ color: BRASS_LT }} />Text
          </a>
        ) : null}
        {!person.phone && person.email ? (
          <a href={`mailto:${person.email}`} className="inline-flex h-[34px] flex-1 items-center justify-center rounded-[9px] px-3 text-[13.5px] font-semibold" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>Email</a>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-3">
        {person.email ? <a href={`mailto:${person.email}`} className="min-w-0 flex-1 truncate text-[12px] hover:underline" style={{ color: "#9aa6a8" }}>{person.email}</a> : <span className="flex-1" />}
        {person.source !== "linked"
          ? <button type="button" disabled={saving} onClick={confirm} className={small} style={{ color: BRASS_LT }}><UserPlus className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save as super"}</button>
          : null}
        <button type="button" onClick={() => setEditing(true)} className={small} style={{ color: "#9fc3b6" }}>{person.source === "linked" ? "Change" : "Edit"}</button>
      </div>
      {error ? <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
    </div>
  );
}

// ---------- Files dropdown ----------

// Job folder files (Drive), plan sets (PlanIntake) and calendar attachments in
// one list. Opening goes through the same paths as before: Drive links, the
// Hub-copy signed URL, then the original link.
export function jobFileItems({ folder, plans, events }) {
  const folderFiles = (folder?.files || []).map((f) => ({ key: `f-${f.id}`, name: f.name, mime: f.mime_type, href: f.url, meta: `Job folder${f.modified_at ? ` · ${day(f.modified_at)}` : ""}` }));
  const intake = (plans || [])
    .map((p) => ({ key: `pi-${p.id}`, name: p.file_name || "Plan document", href: p.drive_file_id ? `https://drive.google.com/file/d/${encodeURIComponent(p.drive_file_id)}/view` : p.page_urls?.[0], meta: p.page_count > 0 ? `Plan set · ${p.page_count} pages` : "Plan set" }))
    .filter((p) => !folderFiles.some((f) => f.name === p.name));
  const dayByUrl = new Map();
  for (const ev of events || []) for (const a of ev.event_attachments || []) if (a?.file_url && !dayByUrl.has(a.file_url)) dayByUrl.set(a.file_url, ev.event_date);
  const cal = eventAttachments(events, { skipJobFolder: !!folder?.folder }).map((a, i) => ({
    key: `c-${i}-${a.file_url}`, name: a.title, mime: a.mime_type, attachment: a, gmailOnly: isGmailOnly(a),
    meta: `Calendar${dayByUrl.get(a.file_url) ? ` · ${day(dayByUrl.get(a.file_url))}` : ""}`,
  }));
  return [...folderFiles, ...intake, ...cal];
}

function FilesMenu({ folder, plans, events }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const items = useMemo(() => jobFileItems({ folder, plans, events }), [folder, plans, events]);
  const gmail = items.filter((i) => i.gmailOnly).length;
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} className={`${HERO_BTN} ${open ? "outline outline-2" : ""}`} style={{ ...HERO_SEC, outlineColor: "rgba(224,201,148,.45)" }}>
        <FileText className="h-[15px] w-[15px]" style={{ color: BRASS_LT }} />Files<span style={{ color: HERO_MUTED, fontWeight: 500 }}>{folder?.loading && !items.length ? "…" : items.length}</span>
        <ChevronDown className="h-[13px] w-[13px]" style={{ color: BRASS_LT }} />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-30 w-[430px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[12px] bg-white max-[699px]:left-0 max-[699px]:right-auto" style={{ border: "1px solid #e2dcd1", boxShadow: "0 18px 44px -12px rgba(21,24,26,.35),0 2px 6px rgba(21,24,26,.06)" }}>
          <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid #eee9e0", backgroundColor: "#faf8f3" }}>
            <b className="text-[13.5px]" style={{ color: INK }}>Job files</b>
            {folder?.folder?.url
              ? <a href={folder.folder.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Open folder<ExternalLink className="h-3 w-3" /></a>
              : <span className="text-[12px]" style={{ color: MUTED }}>{folder?.loading ? "Checking folder…" : "Folder not linked"}</span>}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {!items.length ? <p className="m-0 px-4 py-4 text-[13px]" style={{ color: MUTED }}>{folder?.loading ? "Loading job folder…" : "No files yet. Plans, calendar attachments and job-folder files show up here."}</p> : null}
            {items.map((it, i) => {
              const badge = fileBadge(it.name, it.mime);
              const inner = (
                <>
                  <span className="flex h-[34px] w-7 shrink-0 items-end justify-center rounded-[5px] bg-white pb-[5px] text-[8px] font-bold tracking-[.04em]" style={{ border: "1px solid #e2dcd1", color: badge.ink }}>{badge.label}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13.5px] font-semibold" style={{ color: it.gmailOnly ? MUTED : INK }}>{fileLabel(sanitizeText(it.name), it.name)}</b>
                    <small className="text-[12px]" style={{ color: MUTED }}>{it.meta}</small>
                  </span>
                  {it.gmailOnly
                    ? <span className="shrink-0 whitespace-nowrap rounded-[6px] px-1.5 py-px text-[11px] font-semibold" style={{ color: "#6f4e10", backgroundColor: "#faf0da", border: "1px solid #efdfb7" }}>In Israel&apos;s Gmail</span>
                    : it.attachment?.in_job_folder ? <span className="shrink-0 whitespace-nowrap rounded-[6px] px-1.5 py-px text-[11px] font-semibold" style={{ color: "#082f2c", backgroundColor: "#e2eeeb" }}>In job folder</span>
                    : <ExternalLink className="h-3.5 w-3.5 shrink-0" style={{ color: MUTED }} />}
                </>
              );
              const cls = `flex w-full items-center gap-3 px-4 py-2.5 text-left ${i ? "border-t" : ""}`;
              if (it.gmailOnly) return <div key={it.key} className={cls} style={{ borderColor: "#eee9e0" }} title="Stored in Israel's Gmail. It opens here once his Gmail is connected.">{inner}</div>;
              if (it.attachment) return <button key={it.key} type="button" role="menuitem" onClick={() => openAttachment(it.attachment)} className={`${cls} hover:bg-black/[0.03]`} style={{ borderColor: "#eee9e0" }}>{inner}</button>;
              if (it.href) return <a key={it.key} role="menuitem" href={it.href} target="_blank" rel="noreferrer" className={`${cls} hover:bg-black/[0.03]`} style={{ borderColor: "#eee9e0" }}>{inner}</a>;
              return <div key={it.key} className={cls} style={{ borderColor: "#eee9e0" }} title="No file link recorded">{inner}</div>;
            })}
          </div>
          {gmail || folder?.error || (folder && folder.complete === false) ? (
            <div className="px-4 py-2.5 text-[12px]" style={{ borderTop: "1px solid #eee9e0", backgroundColor: "#faf8f3", color: "#566063" }}>
              {gmail ? <div>{gmail === 1 ? "That file opens" : "Those files open"} here once Israel&apos;s Gmail is connected.</div> : null}
              {folder?.complete === false ? <div>Showing part of the folder. Open it for everything.</div> : null}
              {folder?.error ? <div role="alert" style={{ color: "#a43432" }}>{folder.error}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Hero ----------

const HERO_BTN = "inline-flex h-[38px] items-center gap-[7px] rounded-[9px] px-3.5 text-[13.5px] font-semibold whitespace-nowrap";
const HERO_SEC = { backgroundColor: "rgba(255,255,255,.09)", color: HERO_INK, border: "1px solid rgba(255,255,255,.12)" };
const STEP_CHIP = { bad: ["#f1b9b3", "#4a0f0d"], warn: [BRASS_LT, "#1d160a"], teal: [BRASS_LT, "#1d160a"], neutral: ["rgba(224,201,148,.2)", BRASS_LT] };

export function JobHero({ job, status, snap, jobContacts, events, folder, plans, onFieldReport, onLog, extra, headingLevel = "h1" }) {
  const mapHref = job?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null;
  const dirHref = job?.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}` : null;
  const eyebrow = [snap.kind, sanitizeText(job.builder || "")].filter(Boolean).join(" · ").toUpperCase();
  const [chipBg, chipInk] = STEP_CHIP[snap.step.tone] || STEP_CHIP.neutral;
  const H = headingLevel;
  const [lead, ...rest] = String(snap.step.text || "").split(/(?<=\.)\s+/);

  return (
    <section className="relative z-[3] rounded-[14px]" style={{ background: "linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)", boxShadow: "0 20px 44px -26px rgba(10,29,31,.7)" }}>
      <div className="px-7 pt-7 pb-4 max-[699px]:px-4 max-[699px]:pt-5">
        <div className="flex flex-wrap items-stretch gap-6 max-[699px]:gap-4">
          <div className="min-w-[240px] flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              {eyebrow ? <span className="text-[11px] font-semibold tracking-[.12em]" style={{ color: "#8f999b" }}>{eyebrow}</span> : null}
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: "rgba(224,201,148,.14)", color: BRASS_LT, border: "1px solid rgba(224,201,148,.35)" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />{status.label}
              </span>
            </div>
            <H className="m-0 mt-1.5 break-words text-[32px] font-bold leading-[38px] max-[699px]:text-[26px] max-[699px]:leading-[31px]" style={{ color: HERO_INK, letterSpacing: "-0.035em" }}>{titleCase(sanitizeText(job.canonical_name))}</H>
            {job.address ? (
              <a href={mapHref} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-[7px] text-[14.5px] font-medium hover:underline" style={{ color: "#c9d0d1" }}>
                <MapPin className="h-[15px] w-[15px] shrink-0" style={{ color: BRASS_LT }} />{sanitizeText(job.address)}
              </a>
            ) : null}
          </div>
          <SuperBox jobId={job.id} jobContacts={jobContacts} events={events} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2.5 rounded-[12px] py-2.5 pl-4 pr-2.5" style={{ backgroundColor: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)" }}>
          <span className="shrink-0 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: chipBg, color: chipInk }}>{snap.step.tag}</span>
          <p className="m-0 min-w-[180px] flex-1 text-[15px] font-semibold leading-[21px]" style={{ color: HERO_INK }}>
            {lead}{rest.length ? <span className="font-medium" style={{ color: HERO_MUTED }}> {rest.join(" ")}</span> : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onFieldReport} className={HERO_BTN} style={{ backgroundColor: BRASS, color: "#1d160a" }}><Camera className="h-[15px] w-[15px]" />Field report</button>
            {dirHref ? <a href={dirHref} target="_blank" rel="noreferrer" className={HERO_BTN} style={HERO_SEC}><Navigation className="h-[15px] w-[15px]" style={{ color: BRASS_LT }} />Directions</a> : null}
            <button type="button" onClick={onLog} className={HERO_BTN} style={HERO_SEC}><Plus className="h-[15px] w-[15px]" style={{ color: BRASS_LT }} />Log</button>
            <FilesMenu folder={folder} plans={plans} events={events} />
            {extra}
          </div>
        </div>
      </div>
    </section>
  );
}

export const heroLinkClass = HERO_BTN;
export const heroLinkStyle = HERO_SEC;

// ---------- "The job" and "Scope" ----------

export function JobFactsCard({ snap, folder }) {
  const visit = snap.facts[0];
  const pos = snap.refs.filter((r) => r.startsWith("PO ")).map((r) => r.slice(3));
  const oes = snap.refs.filter((r) => r.startsWith("OE ")).map((r) => r.slice(3));
  const ref = (list) => (list.length ? <span className="font-mono text-[14px] font-medium" title={list.join(", ")}>{list[0]}{list.length > 1 ? <span style={{ color: MUTED }}> +{list.length - 1}</span> : null}</span> : <span style={{ color: MUTED, fontWeight: 500 }}>—</span>);
  const cells = [
    [visit.k, <span key="v" style={{ color: visit.tone === "teal" ? "#0b3f3b" : INK }}>{visit.v}</span>],
    ["Crew", snap.facts[1].v],
    ["PO", ref(pos)],
    ["OE", ref(oes)],
    ["Job folder", folder?.folder?.url
      ? <a key="f" href={folder.folder.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "#0b3f3b" }}>Open in Drive</a>
      : <span key="f" style={{ color: MUTED, fontWeight: 500 }}>{folder?.loading ? "Checking…" : "Not linked"}</span>],
  ];
  return (
    <SheetCard icon={Briefcase} tile={TILE.teal} title="The job" bodyClassName="overflow-hidden rounded-b-[14px]">
      {/* Cells draw their own left and top rules; the outer ones sit under the card edge. */}
      <dl className="-ml-px -mt-px grid grid-cols-5 max-[1100px]:grid-cols-3 max-[599px]:grid-cols-2">
        {cells.map(([k, v]) => (
          <div key={k} className="min-w-0 border-l border-t px-5 py-4 max-[699px]:px-4" style={{ borderColor: "#eee9e0" }}>
            <dt className="text-[11px] font-semibold tracking-[.12em] uppercase" style={{ color: "#566063" }}>{k}</dt>
            <dd className="m-0 mt-1 truncate text-[15px] font-semibold" style={{ color: INK }}>{v}</dd>
          </div>
        ))}
      </dl>
    </SheetCard>
  );
}

export function ScopeCard({ snap }) {
  const parsed = useMemo(() => parseScopeNotes(snap.workText, { refs: false }), [snap.workText]);
  if (!snap.work.length || scopeIsEmpty(parsed)) return null;
  const from = snap.workFrom ? (snap.workFrom.startsWith("from ") ? snap.workFrom : `from the ${/^(today|yesterday|tomorrow)$/i.test(snap.workFrom) ? snap.workFrom.toLowerCase() : snap.workFrom} calendar event`) : "";
  return (
    <SheetCard icon={ClipboardCheck} tile={TILE.bronze} title="Scope" sub={from} bodyClassName="px-5 py-4 max-[699px]:px-4">
      <ScopeNotes parsed={parsed} />
    </SheetCard>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Camera, ChevronDown, Pencil, ClipboardCheck, ExternalLink, FileText, Home, Mail, MapPin, MessageSquare, Phone, HardHat, UserPlus } from "lucide-react";
import { formatShort } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { titleCase } from "@/lib/displayName";
import { ROLE_LABELS } from "@/lib/jobContacts";
import { pickSuper, superChoices, superChoiceGroups, parseScopeNotes, scopeIsEmpty } from "@/lib/jobWorkspace";
import { superEntryComplete, superEntrySig } from "@/lib/superEntry";
import ScopeNotes from "@/components/jobs/ScopeNotes";
import { fileBadge, fileLabel } from "@/lib/jobHistory";
import { eventAttachments, isGmailOnly, openAttachment } from "@/components/jobs/JobEventDocuments";
import { useJobSuper } from "@/hooks/use-job-super";
import { useJobHomeowner, searchContacts } from "@/hooks/use-job-homeowner";
import { pickHomeowner } from "../../../base44/shared/jobHomeowner.js";
import { nextVisitProjection } from "@/lib/jobCalendarShared";
import { homeownerEditLabel, showHomeownerEdit } from "@/lib/homeownerAction";

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

const BOX_SHELL = "w-full rounded-[12px] p-3 pb-2.5";
const BOX_STYLE = { background: "linear-gradient(150deg,rgba(207,227,218,.16),rgba(207,227,218,.06))", border: "1px solid rgba(207,227,218,.22)" };

// compact (desktop hero): a contact on one line: avatar, who and phone, then call / text
// buttons. The phone header keeps the full cards.
const ICON_BTN = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]";
const ICON_SEC = { backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" };
const LINE_LINK = "h-9 shrink-0 px-1 text-[12.5px] font-semibold hover:underline disabled:opacity-60";

function ContactLine({ avatar, label, name, muted = false, sub = null, children }) {
  return (
    <div className="flex min-h-[60px] items-center gap-3 rounded-[12px] px-3 py-2" style={BOX_STYLE}>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>{label}</div>
        <div className="truncate text-[15px] font-bold leading-[1.3]" style={{ color: muted ? HERO_MUTED : HERO_INK, letterSpacing: "-0.01em" }}>{name}</div>
        {sub ? <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 text-[12px]" style={{ color: "#9aa6a8" }}>{sub}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

const Avatar = ({ children, bg, ink }) => <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold" style={{ backgroundColor: bg, color: ink }}>{children}</span>;

function ReachButtons({ person }) {
  const name = sanitizeText(person.name);
  if (person.phone) {
    return (
      <>
        <a href={`tel:${digits(person.phone)}`} className={ICON_BTN} style={{ backgroundColor: "#cfe3da", color: "#082f2c" }} title={`Call ${name}`} aria-label={`Call ${name}`}><Phone className="h-4 w-4" /></a>
        <a href={`sms:${digits(person.phone)}`} className={ICON_BTN} style={ICON_SEC} title={`Text ${name}`} aria-label={`Text ${name}`}><MessageSquare className="h-4 w-4" style={{ color: BRASS_LT }} /></a>
      </>
    );
  }
  if (person.email) return <a href={`mailto:${person.email}`} className={ICON_BTN} style={{ backgroundColor: "#cfe3da", color: "#082f2c" }} title={`Email ${name}`} aria-label={`Email ${name}`}><Mail className="h-4 w-4" /></a>;
  return null;
}

const FIELD = "h-[34px] w-full min-w-0 rounded-[8px] px-2.5 text-[13.5px] outline-none focus:ring-2";
const FIELD_STYLE = { backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.16)", "--tw-ring-color": "rgba(224,201,148,.5)" };

// choices / builderName: when the builder has people on file, "Change" offers them as a
// dropdown first so switching supers is a pick, not a retype.
function SuperForm({ initial, onSave, onCancel, choices = [], builderName = "" }) {
  const [f, setF] = useState({ name: initial?.name || "", phone: initial?.phone || "", email: initial?.email || "" });
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const search = useRef(0);
  const initialSig = useRef(null);
  const triedSig = useRef(null);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  // Saving is automatic: picking a directory match saves right away, and a typed
  // entry saves itself once it has a name plus a full phone or email. The button
  // only remains as an explicit path for entries the auto-save rule waits on.
  const doSave = async (c) => {
    if (saving) return;
    setSaving(true); setError("");
    try { await onSave(c); }
    catch (err) { setError(err.message || "Could not save."); setSaving(false); throw err; }
  };
  // Typing in the name box searches the contact directory so a super can be
  // picked from existing people even when the builder has no one on file.
  useEffect(() => {
    const n = ++search.current;
    if (f.name.trim().length < 2) { setMatches([]); return undefined; }
    const t = setTimeout(() => { searchContacts(f.name).then((list) => { if (n === search.current) setMatches(list); }).catch(() => {}); }, 200);
    return () => clearTimeout(t);
  }, [f.name]);
  const choose = (c) => {
    // Fill first so a failed save leaves the picked values in place for a retry.
    const next = { name: c.name || "", phone: c.phone || "", email: c.email || "" };
    setMatches([]); setF(next);
    triedSig.current = `${next.name.trim()}|${next.phone.trim()}|${next.email.trim()}`;
    doSave(next).catch(() => { triedSig.current = null; });
  };
  const idOf = (c) => c.key || `${c.name}|${c.phone}`;
  const pickChoice = async (e) => {
    const c = choices.find((x) => idOf(x) === e.target.value);
    if (!c) return;
    doSave({ name: c.name, phone: c.phone || "", email: c.email || "" }).catch(() => {});
  };
  const complete = superEntryComplete(f);
  const sig = superEntrySig(f);
  if (initialSig.current === null) initialSig.current = sig;
  useEffect(() => {
    // Never save on open (initial values) or twice for the same entry; a failed
    // save re-arms only after the entry changes.
    if (!complete || sig === initialSig.current || sig === triedSig.current) return undefined;
    const t = setTimeout(() => {
      triedSig.current = sig;
      doSave({ name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() })
        .catch(() => { triedSig.current = null; });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, complete]);
  // No save button: a complete entry saves itself, and Enter only hurries a
  // complete entry along. Partial entries never save and say so above.
  const submit = (e) => {
    e.preventDefault();
    if (!complete || saving) return;
    triedSig.current = sig;
    doSave({ name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() }).catch(() => { triedSig.current = null; });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>{initial?.name ? "CHANGE SUPER" : "ADD SUPER"}</div>
      {choices.length > 0 && (
        <label className="relative block">
          <span className="sr-only">Pick a super from {builderName}</span>
          <select value="" disabled={saving} onChange={pickChoice} className="h-[36px] w-full appearance-none rounded-[8px] pl-2.5 pr-9 text-[13.5px] font-semibold outline-none focus:ring-2 disabled:opacity-60" style={{ backgroundColor: "#cfe3da", color: "#082f2c", border: "1px solid rgba(207,227,218,.5)" }}>
            <option value="">Pick from {builderName || "the builder"} ({choices.length})</option>
            {superChoiceGroups(choices).map(([label, list]) => (
              <optgroup key={label} label={label}>
                {list.map((c) => <option key={idOf(c)} value={idOf(c)}>{[sanitizeText(c.name), c.title || ROLE_LABELS[c.role] || "", c.phone].filter(Boolean).join(" · ")}</option>)}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "#082f2c" }} />
        </label>
      )}
      {choices.length > 0 && <div className="text-[11px] font-semibold tracking-[.1em]" style={{ color: "#8f999b" }}>OR TYPE A NEW ONE</div>}
      <div className="relative">
        <input autoFocus={!choices.length} aria-label="Super name" placeholder="Name (or search contacts)" autoComplete="off" value={f.name} onChange={set("name")} className={FIELD} style={FIELD_STYLE} />
        {matches.length > 0 ? (
          <ul role="listbox" aria-label="Matching contacts" className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-[9px] bg-white" style={{ border: "1px solid #e2dcd1", boxShadow: "0 12px 30px -10px rgba(21,24,26,.4)" }}>
            {matches.map((c) => (
              <li key={c.key}>
                <button type="button" role="option" aria-selected="false" onClick={() => choose(c)} className="block min-h-11 w-full px-3 py-2 text-left hover:bg-black/[0.04]">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: INK }}>{sanitizeText(c.name)}</span>
                  <span className="block truncate text-[11.5px]" style={{ color: MUTED }}>{[c.company, c.title, c.phone || c.email].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <input aria-label="Super phone" placeholder="Phone" inputMode="tel" value={f.phone} onChange={set("phone")} className={FIELD} style={FIELD_STYLE} />
      <input aria-label="Super email" placeholder="Email (optional)" inputMode="email" value={f.email} onChange={set("email")} className={FIELD} style={FIELD_STYLE} />
      {error ? <p role="alert" className="m-0 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : (
        <p className="m-0 text-[12px]" style={{ color: "#8f999b" }}>
          {saving ? "Saving…" : complete ? "Saves automatically." : "Saves automatically once there's a name and a full phone or email."}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="inline-flex h-[34px] flex-1 items-center justify-center rounded-[9px] px-3 text-[13.5px] font-semibold" style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" }}>{saving ? "Close without saving" : "Cancel"}</button>
      </div>
    </form>
  );
}

export function SuperBox({ jobId, jobContacts, events, compact = false }) {
  const jobSuper = useJobSuper(jobId);
  const view = jobContacts?.view?.job?.id === jobId ? jobContacts.view : null;
  const person = useMemo(() => pickSuper({ saved: jobSuper.saved, view, events }), [jobSuper.saved, view, events]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setError(""); setEditing(false); }, [jobId]);

  const shell = BOX_SHELL;
  const shellStyle = BOX_STYLE;
  const label = person?.role && person.role !== "superintendent" ? (ROLE_LABELS[person.role] || "Contact").toUpperCase() : "SUPER";
  const tagText = person?.source === "notes" ? ` · FROM ${person.day ? day(person.day).toUpperCase() : "CALENDAR"} NOTES`
    : person?.source === "suggestion" ? " · SUGGESTED"
    : person?.source === "builder" ? ` · ${sanitizeText(view?.job?.builder || "BUILDER").toUpperCase()}'S SUPER` : "";
  const labelNode = <>{label}{tagText ? <span style={{ color: "#8f999b" }}>{tagText}</span> : null}</>;
  const save = async (contact) => {
    await jobSuper.save(contact);
    setEditing(false);
    if (jobContacts?.phase && jobContacts.phase !== "private") jobContacts.reload();
  };
  const small = "inline-flex items-center gap-1.5 text-[12.5px] font-semibold hover:underline disabled:opacity-60";

  if (editing) return <div className={shell} style={shellStyle}><SuperForm initial={person?.source === "linked" ? person : person ? { ...person } : null} onSave={save} onCancel={() => setEditing(false)} choices={superChoices(view).filter((c) => !person || c.key !== person.key)} builderName={sanitizeText(view?.job?.builder || "")} /></div>;

  if (!person) {
    // No super on file: a dropdown of the builder's people (and any suggested supers)
    // so the right one is a two-tap pick; a strong candidate also gets a one-tap row.
    const choices = superChoices(view);
    const quick = choices.filter((c) => c.suggested || c.role === "superintendent").slice(0, 2);
    const groups = superChoiceGroups(choices);
    const idOf = (c) => c.key || `${c.name}|${c.phone}`;
    const pick = async (c) => {
      setSaving(true); setError("");
      try { await save({ name: c.name, phone: c.phone || "", email: c.email || "" }); }
      catch (e) { setError(e.message || "Could not save."); }
      finally { setSaving(false); }
    };
    const builderName = sanitizeText(view?.job?.builder || "the builder");
    const optionGroups = groups.map(([label, list]) => (
      <optgroup key={label} label={label}>
        {list.map((c) => <option key={idOf(c)} value={idOf(c)}>{[sanitizeText(c.name), c.title || ROLE_LABELS[c.role] || "", c.phone].filter(Boolean).join(" · ")}</option>)}
      </optgroup>
    ));
    const onPick = (e) => { const c = choices.find((x) => idOf(x) === e.target.value); if (c) pick(c); };
    if (compact) {
      return (
        <ContactLine
          avatar={<Avatar bg="rgba(207,227,218,.18)" ink="#cfe3da"><HardHat className="h-4 w-4" /></Avatar>}
          label="SUPER"
          muted
          name={jobSuper.loading && jobContacts?.phase === "loading" ? "Looking…" : saving ? "Saving…" : "Not on file yet"}
          sub={quick[0] || error ? (
            <>
              {quick[0] ? <button type="button" disabled={saving} onClick={() => pick(quick[0])} className="min-w-0 truncate font-semibold hover:underline disabled:opacity-60" style={{ color: BRASS_LT }}>Use {sanitizeText(quick[0].name)}</button> : null}
              {error ? <span role="alert" style={{ color: "#f1b9b3" }}>{error}</span> : null}
            </>
          ) : null}
        >
          {choices.length > 0 ? (
            <label className="relative block">
              <span className="sr-only">Pick a super from {builderName}</span>
              <select value="" disabled={saving} onChange={onPick} className="h-9 w-[124px] appearance-none rounded-[9px] pl-2.5 pr-7 text-[12.5px] font-semibold outline-none focus:ring-2 disabled:opacity-60" style={{ ...FIELD_STYLE, backgroundColor: "#cfe3da", color: "#082f2c", border: "1px solid rgba(207,227,218,.5)" }}>
                <option value="">Pick super ({choices.length})</option>
                {optionGroups}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "#082f2c" }} />
            </label>
          ) : null}
          {choices.length > 0
            ? <button type="button" onClick={() => setEditing(true)} className={ICON_BTN} style={ICON_SEC} title="Someone not listed" aria-label="Add someone not listed"><UserPlus className="h-3.5 w-3.5" style={{ color: BRASS_LT }} /></button>
            : <button type="button" onClick={() => setEditing(true)} className={`${ICON_BTN} w-auto gap-1.5 px-3 text-[13px] font-semibold`} style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}><UserPlus className="h-3.5 w-3.5" />Add super</button>}
        </ContactLine>
      );
    }
    return (
      <div className={shell} style={shellStyle}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(207,227,218,.18)", color: "#cfe3da" }}><HardHat className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>SUPER</div>
            <div className="text-[14.5px] font-semibold" style={{ color: HERO_MUTED }}>{jobSuper.loading && jobContacts?.phase === "loading" ? "Looking…" : saving ? "Saving…" : "Not on file yet"}</div>
          </div>
        </div>
        {quick.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {quick.map((c) => (
              <button key={idOf(c)} type="button" disabled={saving} onClick={() => pick(c)} className="flex min-h-[40px] w-full items-center gap-2.5 rounded-[9px] px-3 text-left disabled:opacity-60" style={{ backgroundColor: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)" }}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>{initials(c.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold" style={{ color: HERO_INK }}>{sanitizeText(c.name)}</span>
                  <span className="block truncate text-[11.5px]" style={{ color: "#9aa6a8" }}>{[c.suggested ? "Suggested for this job" : c.title || ROLE_LABELS[c.role] || "Contact", c.phone].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold" style={{ color: BRASS_LT }}>Use as super</span>
              </button>
            ))}
          </div>
        )}
        {choices.length > 0 && (
          <label className="relative mt-3 block">
            <span className="sr-only">Pick a super from {builderName}</span>
            <select
              value=""
              disabled={saving}
              onChange={onPick}
              className="h-[40px] w-full appearance-none rounded-[9px] pl-3 pr-9 text-[13.5px] font-semibold outline-none focus:ring-2 disabled:opacity-60"
              style={{ ...FIELD_STYLE, backgroundColor: "#cfe3da", color: "#082f2c", border: "1px solid rgba(207,227,218,.5)" }}
            >
              <option value="">Pick a super from {builderName} ({choices.length})</option>
              {optionGroups}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "#082f2c" }} />
          </label>
        )}
        <button type="button" onClick={() => setEditing(true)} className={`${choices.length ? "mt-2" : "mt-3"} inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[9px] text-[13.5px] font-semibold`} style={choices.length ? { backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" } : { backgroundColor: "#cfe3da", color: "#082f2c" }}>
          <UserPlus className="h-3.5 w-3.5" />{choices.length ? "Someone not listed" : "Add super"}
        </button>
        {error ? <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
      </div>
    );
  }

  const confirm = async () => {
    setSaving(true); setError("");
    try { await save({ name: person.name, phone: person.phone, email: person.email }); }
    catch (e) { setError(e.message || "Could not save."); }
    finally { setSaving(false); }
  };

  if (compact) {
    return (
      <ContactLine
        avatar={<Avatar bg="#cfe3da" ink="#082f2c">{initials(person.name)}</Avatar>}
        label={labelNode}
        name={sanitizeText(person.name) || "Unknown"}
        sub={(
          <>
            {person.phone ? <span className="font-mono-num">{person.phone}</span> : person.email ? <span className="min-w-0 truncate">{person.email}</span> : null}
            {person.source !== "linked" ? <button type="button" disabled={saving} onClick={confirm} className="font-semibold hover:underline disabled:opacity-60" style={{ color: BRASS_LT }}>{saving ? "Saving…" : "Save as super"}</button> : null}
            {error ? <span role="alert" style={{ color: "#f1b9b3" }}>{error}</span> : null}
          </>
        )}
      >
        <ReachButtons person={person} />
        <button type="button" onClick={() => setEditing(true)} className={LINE_LINK} style={{ color: "#9fc3b6" }}>{person.source === "linked" ? "Change" : "Edit"}</button>
      </ContactLine>
    );
  }

  return (
    <div className={shell} style={shellStyle}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>{initials(person.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>
            {labelNode}
          </div>
          <div className="break-words text-[17px] font-bold leading-[1.25]" style={{ color: HERO_INK, letterSpacing: "-0.01em" }}>{sanitizeText(person.name) || "Unknown"}</div>
        </div>
        <button type="button" onClick={() => setEditing(true)} className={`${small} h-11 shrink-0 px-1`} style={{ color: "#9fc3b6" }}>{person.source === "linked" ? "Change" : "Edit"}</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {person.phone ? (
          <a href={`tel:${digits(person.phone)}`} className="inline-flex min-h-11 flex-1 shrink-0 basis-auto items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }} title={`Call ${sanitizeText(person.name)}`}>
            <Phone className="h-3.5 w-3.5 shrink-0" /><span>{person.phone}</span>
          </a>
        ) : null}
        {person.phone ? (
          <a href={`sms:${digits(person.phone)}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" }}>
            <MessageSquare className="h-3.5 w-3.5" style={{ color: BRASS_LT }} />Text
          </a>
        ) : null}
        {!person.phone && person.email ? (
          <a href={`mailto:${person.email}`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[9px] px-3 text-[13.5px] font-semibold" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>Email</a>
        ) : null}
      </div>
      {person.email || (person.source !== "linked") ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {person.email ? <a href={`mailto:${person.email}`} className="min-w-0 flex-1 truncate text-[12px] hover:underline" style={{ color: "#9aa6a8" }}>{person.email}</a> : <span className="flex-1" />}
          {person.source !== "linked"
            ? <button type="button" disabled={saving} onClick={confirm} className={`${small} max-[699px]:min-h-11`} style={{ color: BRASS_LT }}><UserPlus className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save as super"}</button>
            : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
    </div>
  );
}

// ---------- Homeowner card (directly under the super, same access as the super) ----------

function HomeownerForm({ initial, canRemove, onSave, onRemove, onCancel }) {
  const [f, setF] = useState({ name: initial?.name || "", phone: initial?.phone || "", email: initial?.email || "" });
  const [picked, setPicked] = useState(null);
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const search = useRef(0);
  const set = (k) => (e) => { setPicked(null); setF((v) => ({ ...v, [k]: e.target.value })); };
  useEffect(() => {
    const n = ++search.current;
    if (picked || f.name.trim().length < 2) { setMatches([]); return undefined; }
    const t = setTimeout(() => { searchContacts(f.name).then((list) => { if (n === search.current) setMatches(list); }).catch(() => {}); }, 200);
    return () => clearTimeout(t);
  }, [f.name, picked]);
  const choose = (c) => { setPicked(c); setMatches([]); setF({ name: c.name || "", phone: c.phone || "", email: c.email || "" }); };
  const run = async (fn) => {
    setSaving(true); setError("");
    try { await fn(); } catch (err) { setError(err.message || "Could not save."); setSaving(false); }
  };
  const submit = (e) => {
    e.preventDefault();
    if (picked) { run(() => onSave({ contactKey: picked.key })); return; }
    if (!f.name.trim() || (!f.phone.trim() && !f.email.trim())) { setError("Add a name and a phone or email."); return; }
    run(() => onSave({ name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() }));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>{canRemove ? "CHANGE HOMEOWNER" : "ADD HOMEOWNER"}</div>
      <div className="relative">
        <input autoFocus aria-label="Homeowner name" placeholder="Name (or search contacts)" autoComplete="off" value={f.name} onChange={set("name")} className={FIELD} style={FIELD_STYLE} />
        {matches.length > 0 ? (
          <ul role="listbox" aria-label="Matching contacts" className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-[9px] bg-white" style={{ border: "1px solid #e2dcd1", boxShadow: "0 12px 30px -10px rgba(21,24,26,.4)" }}>
            {matches.map((c) => (
              <li key={c.key}>
                <button type="button" role="option" aria-selected="false" onClick={() => choose(c)} className="block min-h-11 w-full px-3 py-2 text-left hover:bg-black/[0.04]">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: INK }}>{sanitizeText(c.name)}</span>
                  <span className="block truncate text-[11.5px]" style={{ color: MUTED }}>{[c.company, c.phone || c.email].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {picked ? <p className="m-0 text-[12px]" style={{ color: "#9fc3b6" }}>Using the saved contact {sanitizeText(picked.name)}{picked.company ? ` (${sanitizeText(picked.company)})` : ""}.</p> : null}
      <input aria-label="Homeowner phone" placeholder="Phone" inputMode="tel" value={f.phone} onChange={set("phone")} className={FIELD} style={FIELD_STYLE} />
      <input aria-label="Homeowner email" placeholder="Email (optional)" inputMode="email" value={f.email} onChange={set("email")} className={FIELD} style={FIELD_STYLE} />
      {error ? <p role="alert" className="m-0 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="inline-flex min-h-[34px] flex-1 items-center justify-center rounded-[9px] text-[13.5px] font-semibold disabled:opacity-60 max-[699px]:min-h-11" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>{saving ? "Saving…" : "Save homeowner"}</button>
        <button type="button" onClick={onCancel} className="inline-flex min-h-[34px] items-center rounded-[9px] px-3 text-[13.5px] font-semibold max-[699px]:min-h-11" style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" }}>Cancel</button>
        {canRemove ? <button type="button" disabled={saving} onClick={() => run(onRemove)} className="inline-flex min-h-[34px] items-center px-1 text-[12.5px] font-semibold hover:underline disabled:opacity-60 max-[699px]:min-h-11" style={{ color: "#f1b9b3" }}>Remove</button> : null}
      </div>
    </form>
  );
}

export function HomeownerBox({ job, jobContacts, compact = false }) {
  const jobId = job?.id;
  const homeowner = useJobHomeowner(jobId);
  const view = jobContacts?.view?.job?.id === jobId ? jobContacts.view : null;
  const person = useMemo(() => pickHomeowner({ saved: homeowner.saved, view, job }), [homeowner.saved, view, job]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setError(""); setEditing(false); }, [jobId]);
  const refresh = () => { if (jobContacts?.phase && jobContacts.phase !== "private") jobContacts.reload(); };
  const save = async (input) => { await homeowner.save(input); setEditing(false); refresh(); };
  const remove = async () => { await homeowner.remove(); setEditing(false); refresh(); };
  const small = "inline-flex min-h-[30px] items-center gap-1.5 text-[12.5px] font-semibold hover:underline disabled:opacity-60 max-[699px]:min-h-11";

  if (editing) {
    return <div className={BOX_SHELL} style={BOX_STYLE}><HomeownerForm initial={person} canRemove={person?.source === "linked"} onSave={save} onRemove={remove} onCancel={() => setEditing(false)} /></div>;
  }
  if (!person && compact) {
    return (
      <ContactLine
        avatar={<Avatar bg="rgba(207,227,218,.18)" ink="#cfe3da"><Home className="h-4 w-4" /></Avatar>}
        label="HOMEOWNER"
        muted
        name={homeowner.loading ? "Looking…" : "Not on file yet"}
        sub={homeowner.error ? <span role="alert" style={{ color: "#f1b9b3" }}>{homeowner.error}</span> : null}
      >
        <button type="button" onClick={() => setEditing(true)} className={`${ICON_BTN} w-auto gap-1.5 px-3 text-[13px] font-semibold`} style={ICON_SEC}><UserPlus className="h-3.5 w-3.5" style={{ color: BRASS_LT }} />Add</button>
      </ContactLine>
    );
  }
  if (!person) {
    return (
      <div className={BOX_SHELL} style={BOX_STYLE}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(207,227,218,.18)", color: "#cfe3da" }}><Home className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>HOMEOWNER</div>
            <div className="text-[14.5px] font-semibold" style={{ color: HERO_MUTED }}>{homeowner.loading ? "Looking…" : "Not on file yet"}</div>
          </div>
          <button type="button" onClick={() => setEditing(true)} className={`${small} max-[699px]:min-h-11`} style={{ color: BRASS_LT }}>
            <UserPlus className="h-3.5 w-3.5" />Add
          </button>
        </div>
        {homeowner.error ? <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#f1b9b3" }}>{homeowner.error}</p> : null}
      </div>
    );
  }
  const confirm = async () => {
    setSaving(true); setError("");
    try { await save({ contactKey: person.key }); } catch (e) { setError(e.message || "Could not save."); } finally { setSaving(false); }
  };
  const tag = person.source === "suggestion" ? " · SUGGESTED" : person.source === "job" ? " · FROM JOB RECORD" : "";
  if (compact) {
    return (
      <ContactLine
        avatar={<Avatar bg="#e0c994" ink="#1d160a">{initials(person.name)}</Avatar>}
        label={<>HOMEOWNER{tag ? <span style={{ color: "#8f999b" }}>{tag}</span> : null}</>}
        name={<>{sanitizeText(person.name) || "Unknown"}{person.note ? <span className="text-[12.5px] font-medium" style={{ color: HERO_MUTED }}> ({sanitizeText(person.note)})</span> : null}</>}
        sub={(
          <>
            {person.phone ? <span className="font-mono-num">{person.phone}</span> : person.email ? <span className="min-w-0 truncate">{person.email}</span> : person.source === "job" ? <span>No phone on file</span> : null}
            {person.source === "suggestion" ? <button type="button" disabled={saving} onClick={confirm} className="font-semibold hover:underline disabled:opacity-60" style={{ color: BRASS_LT }}>{saving ? "Saving…" : "Save as homeowner"}</button> : null}
            {error ? <span role="alert" style={{ color: "#f1b9b3" }}>{error}</span> : null}
          </>
        )}
      >
        <ReachButtons person={person} />
        {showHomeownerEdit(person) ? <button type="button" onClick={() => setEditing(true)} className={LINE_LINK} style={{ color: person.source === "job" ? BRASS_LT : "#9fc3b6" }}>{homeownerEditLabel(person)}</button> : null}
      </ContactLine>
    );
  }
  return (
    <div className={BOX_SHELL} style={BOX_STYLE}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold" style={{ backgroundColor: "#e0c994", color: "#1d160a" }}>{initials(person.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>HOMEOWNER{tag ? <span style={{ color: "#8f999b" }}>{tag}</span> : null}</div>
          <div className="break-words text-[17px] font-bold leading-[1.25]" style={{ color: HERO_INK, letterSpacing: "-0.01em" }}>{sanitizeText(person.name) || "Unknown"}{person.note ? <span className="text-[12.5px] font-medium" style={{ color: HERO_MUTED }}> ({sanitizeText(person.note)})</span> : null}</div>
        </div>
        {showHomeownerEdit(person) ? (
          <button type="button" onClick={() => setEditing(true)} className={`${small} h-11 shrink-0 px-1`} style={{ color: person.source === "job" ? BRASS_LT : "#9fc3b6" }}>{homeownerEditLabel(person)}</button>
        ) : null}
      </div>
      {person.phone || person.email ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {person.phone ? (
            <a href={`tel:${digits(person.phone)}`} className="inline-flex min-h-11 flex-1 shrink-0 basis-auto items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }} title={`Call ${sanitizeText(person.name)}`}>
              <Phone className="h-3.5 w-3.5 shrink-0" /><span>{person.phone}</span>
            </a>
          ) : null}
          {person.phone ? (
            <a href={`sms:${digits(person.phone)}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.14)" }}>
              <MessageSquare className="h-3.5 w-3.5" style={{ color: BRASS_LT }} />Text
            </a>
          ) : null}
          {!person.phone && person.email ? (
            <a href={`mailto:${person.email}`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[9px] px-3 text-[13.5px] font-semibold" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>Email</a>
          ) : null}
        </div>
      ) : null}
      {person.email || person.source === "suggestion" || person.source === "job" ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {person.email ? <a href={`mailto:${person.email}`} className="min-w-0 flex-1 truncate text-[12px] hover:underline" style={{ color: "#9aa6a8" }}>{person.email}</a> : <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "#8f999b" }}>{person.source === "job" ? "No phone on file" : ""}</span>}
          {person.source === "suggestion"
            ? <button type="button" disabled={saving} onClick={confirm} className={`${small} max-[699px]:min-h-11`} style={{ color: BRASS_LT }}><UserPlus className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save as homeowner"}</button>
            : null}
        </div>
      ) : null}
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

// tile: the phone header's square icon tile instead of the hero pill button.
export function FilesMenu({ folder, plans, events, tile = false }) {
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
      {tile ? (
        <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-[12px] text-[12px] font-semibold" style={{ backgroundColor: "#1a3537", border: `1px solid ${open ? "rgba(224,201,148,.55)" : "#2e4c4c"}`, color: HERO_INK }}>
          <FileText className="h-[18px] w-[18px]" style={{ color: BRASS_LT }} />
          <span>Files{folder?.loading && !items.length ? "" : items.length ? ` · ${items.length}` : ""}</span>
        </button>
      ) : (
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} className={`${HERO_BTN} ${open ? "outline outline-2" : ""}`} style={{ ...HERO_SEC, outlineColor: "rgba(224,201,148,.45)" }}>
        <FileText className="h-[15px] w-[15px]" style={{ color: BRASS_LT }} />Files<span style={{ color: HERO_MUTED, fontWeight: 500 }}>{folder?.loading && !items.length ? "…" : items.length}</span>
        <ChevronDown className="h-[13px] w-[13px]" style={{ color: BRASS_LT }} />
      </button>
      )}
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

// ---------- Editable title ----------

// Tap the pencil to rename the job in place. Enter saves, Escape cancels.
function JobTitle({ job, onRename, headingLevel }) {
  const H = headingLevel;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEditing(false); setError(""); }, [job?.id]);
  const shown = titleCase(sanitizeText(job.canonical_name));
  const start = () => { setValue(job.canonical_name || ""); setError(""); setEditing(true); };
  const save = async () => {
    if (saving) return;
    const next = value.replace(/\s+/g, " ").trim();
    if (!next || next === job.canonical_name) { setEditing(false); return; }
    setSaving(true); setError("");
    try { await onRename(next); setEditing(false); }
    catch (e) { setError(e.message || "Could not rename."); }
    finally { setSaving(false); }
  };
  if (editing && onRename) {
    return (
      <div className="mt-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus aria-label="Job name" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setEditing(false); }}
            className="min-w-[220px] flex-1 rounded-[9px] px-3 text-[24px] font-bold leading-[44px] outline-none max-[699px]:text-[20px]"
            style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(224,201,148,.45)", letterSpacing: "-0.03em" }}
          />
          <button type="button" onClick={save} disabled={saving} className="inline-flex h-[38px] items-center rounded-[9px] px-3.5 text-[13.5px] font-semibold disabled:opacity-60" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="inline-flex h-[38px] items-center rounded-[9px] px-3 text-[13.5px] font-semibold" style={HERO_SEC}>Cancel</button>
        </div>
        {error ? <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
        <p className="m-0 mt-1 text-[12px]" style={{ color: "#8f999b" }}>The old name is kept so past visits and files still match this job.</p>
      </div>
    );
  }
  return (
    <div className="group mt-1.5 flex items-start gap-2">
      <H className="m-0 break-words text-[32px] font-bold leading-[38px] max-[699px]:text-[26px] max-[699px]:leading-[31px]" style={{ color: HERO_INK, letterSpacing: "-0.035em" }}>{shown}</H>
      {onRename ? (
        <button type="button" onClick={start} aria-label="Rename job" title="Rename job" className="mt-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] opacity-60 hover:opacity-100 max-[699px]:mt-1" style={{ color: BRASS_LT, backgroundColor: "rgba(255,255,255,.06)" }}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}


// ---------- Editable job address (manager-only; page gates the prop) ----------

// Tap the pencil to edit the job-site address in place; Enter saves, Escape
// cancels. Clearing the field removes the address. Mirrors the JobTitle
// interaction. Only rendered when the page passes onEditAddress (owner gate).
export function JobAddress({ job, onEditAddress }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEditing(false); setError(""); }, [job?.id]);
  const dirHref = job?.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}` : null;
  const start = () => { setValue(job.address || ""); setError(""); setEditing(true); };
  const save = async () => {
    if (saving) return;
    const next = value.replace(/\s+/g, " ").trim();
    if (next === (job.address || "")) { setEditing(false); return; }
    setSaving(true); setError("");
    try { await onEditAddress(next); setEditing(false); }
    catch (e) { setError(e.message || "Could not save the address."); }
    finally { setSaving(false); }
  };
  if (editing) {
    return (
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus aria-label="Job address" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setEditing(false); }}
            placeholder="Job-site address"
            className="min-w-[220px] flex-1 rounded-[9px] px-3 text-[15px] font-medium leading-[38px] outline-none"
            style={{ backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(224,201,148,.45)" }}
          />
          <button type="button" onClick={save} disabled={saving} className="inline-flex h-[38px] items-center rounded-[9px] px-3.5 text-[13.5px] font-semibold disabled:opacity-60" style={{ backgroundColor: "#cfe3da", color: "#082f2c" }}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="inline-flex h-[38px] items-center rounded-[9px] px-3 text-[13.5px] font-semibold" style={HERO_SEC}>Cancel</button>
        </div>
        {error ? <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: "#f1b9b3" }}>{error}</p> : null}
        <p className="m-0 mt-1 text-[12px]" style={{ color: "#8f999b" }}>The job-site address stays put; calendar pickup or delivery stops never replace it.</p>
      </div>
    );
  }
  return (
    <div className="group mt-2 flex items-center gap-2">
      {job.address ? (
        <a href={dirHref} target="_blank" rel="noopener noreferrer" title="Get directions" aria-label={`Get directions to ${sanitizeText(job.address)}`} className="inline-flex min-h-11 items-center gap-[7px] text-[14.5px] font-medium hover:underline" style={{ color: "#c9d0d1" }}>
          <MapPin className="h-[15px] w-[15px] shrink-0" style={{ color: BRASS_LT }} />{sanitizeText(job.address)}
        </a>
      ) : (
        <span className="inline-flex min-h-11 items-center gap-[7px] text-[13.5px]" style={{ color: "#8f999b" }}>
          <MapPin className="h-[15px] w-[15px] shrink-0" style={{ color: BRASS_LT }} />No job-site address on file
        </span>
      )}
      {onEditAddress ? (
        <button type="button" onClick={start} aria-label={job.address ? "Edit job address" : "Add job address"} title={job.address ? "Edit job address" : "Add job address"} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] opacity-60 hover:opacity-100" style={{ color: BRASS_LT, backgroundColor: "rgba(255,255,255,.06)" }}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// ---------- Hero ----------


const HERO_BTN = "inline-flex h-[38px] items-center gap-[7px] rounded-[9px] px-3.5 text-[13.5px] font-semibold whitespace-nowrap";
const HERO_SEC = { backgroundColor: "rgba(255,255,255,.09)", color: HERO_INK, border: "1px solid rgba(255,255,255,.12)" };
const STEP_CHIP = { bad: ["#f1b9b3", "#4a0f0d"], warn: [BRASS_LT, "#1d160a"], teal: [BRASS_LT, "#1d160a"], neutral: ["rgba(224,201,148,.2)", BRASS_LT] };

// Crew, every PO and OE, and the job folder, folded under the address. Same values the
// old "The job" card showed (snap.refs / snap.facts from jobSnapshot, folder from
// useJobFolderFiles); closed by default.
function JobInfo({ snap, folder }) {
  const [open, setOpen] = useState(false);
  const pos = (snap?.refs || []).filter((r) => r.startsWith("PO ")).map((r) => r.slice(3));
  const oes = (snap?.refs || []).filter((r) => r.startsWith("OE ")).map((r) => r.slice(3));
  const more = (list) => (list.length > 1 ? ` +${list.length - 1}` : "");
  const hint = [pos[0] ? `PO ${pos[0]}${more(pos)}` : "", oes[0] ? `OE ${oes[0]}${more(oes)}` : ""].filter(Boolean).join(" · ");
  const crew = snap?.facts?.[1]?.v || "—";
  const LABEL = { color: "#9fc3b6" };
  const cells = [
    ["Crew", <span key="c">{crew}</span>],
    ["PO", pos.length ? <span key="p" className="font-mono text-[12.5px] font-medium">{pos.map((p) => <span key={p} className="block">{p}</span>)}</span> : <span key="p" style={{ opacity: 0.6 }}>—</span>],
    ["OE", oes.length ? <span key="o" className="font-mono text-[12.5px] font-medium">{oes.map((o) => <span key={o} className="block">{o}</span>)}</span> : <span key="o" style={{ opacity: 0.6 }}>—</span>],
    ["Job folder", folder?.folder?.url
      ? <a key="f" href={folder.folder.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: BRASS_LT }}>Open in Drive</a>
      : <span key="f" style={{ opacity: 0.6 }}>{folder?.loading ? "Checking…" : "Not linked"}</span>],
  ];
  return (
    <div className="mt-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex max-w-full items-center gap-2.5 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold" style={{ backgroundColor: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)", color: HERO_INK }}>
        Job info
        {hint ? <span className="min-w-0 truncate font-mono text-[12px] font-normal" style={{ color: HERO_MUTED }}>{hint}</span> : null}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: BRASS_LT }} />
      </button>
      {open ? (
        <dl className="m-0 mt-2.5 grid max-w-[720px] grid-cols-4 overflow-hidden rounded-[12px] max-[699px]:grid-cols-2" style={{ border: "1px solid rgba(255,255,255,.12)", backgroundColor: "rgba(255,255,255,.04)" }}>
          {cells.map(([k, v]) => (
            <div key={k} className="min-w-0 border-l px-3.5 py-2.5 first:border-l-0 max-[699px]:[&:nth-child(3)]:border-l-0 max-[699px]:[&:nth-child(n+3)]:border-t" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[.12em]" style={LABEL}>{k}</dt>
              <dd className="m-0 mt-1 text-[14px] font-semibold leading-[1.45] break-words" style={{ color: HERO_INK }}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

// progress (optional): jobProgress() from jobStages — shows a small "Stage n of 7" chip.
// alert (optional): a node shown first in the chip row by the job name — the red service-item marker.
export function JobHero({ job, status, snap, jobContacts, events, folder, plans, onFieldReport, onRename, onEditAddress = null, extra, headingLevel = "h1", progress = null, alert = null, upcoming = null, payment = null, corner = null }) {
  // The builder already leads most job names ("Bangerter Homes - Gomez Res"); only add it
  // to the eyebrow when the title doesn't carry it.
  const builderText = sanitizeText(job.builder || "");
  const flat = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const builderInTitle = builderText && flat(job.canonical_name).includes(flat(builderText).split(" ")[0]);
  const eyebrow = [snap.kind, builderInTitle ? "" : builderText].filter(Boolean).join(" · ").toUpperCase();
  const [chipBg, chipInk] = STEP_CHIP[snap.step.tone] || STEP_CHIP.neutral;
  const [lead, ...rest] = String(snap.step.text || "").split(/(?<=\.)\s+/);
  // When the scoped crew-calendar read found a confirmed upcoming visit, the hero
  // leads with it instead of the saved-completion step (which may lag the live
  // calendar). Saved job completion status (status.label, snap) is untouched.
  const proj = useMemo(() => (upcoming && upcoming.events && upcoming.events.length) ? nextVisitProjection(upcoming.events) : null, [upcoming]);
  const [heroExpanded, setHeroExpanded] = useState(false);
  useEffect(() => { setHeroExpanded(false); }, [proj]);

  return (
    <section className="relative z-[3] rounded-[14px]" style={{ background: "linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)", boxShadow: "0 20px 44px -26px rgba(10,29,31,.7)" }}>
      {corner ? <div className="absolute right-3 top-3">{corner}</div> : null}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4 px-6 pt-5 pb-4 max-[699px]:px-4 max-[699px]:pt-4">
        <div className="min-w-[260px] flex-1 max-[699px]:min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {alert}
            {eyebrow ? <span className="text-[11px] font-semibold tracking-[.12em]" style={{ color: "#8f999b" }}>{eyebrow}</span> : null}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: "rgba(224,201,148,.14)", color: BRASS_LT, border: "1px solid rgba(224,201,148,.35)" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />{status.label}
            </span>
            {progress?.current ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: "rgba(47,158,95,.16)", color: "#a8e6c1", border: "1px solid rgba(120,210,160,.3)" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#46c27e", boxShadow: "0 0 0 3px rgba(70,194,126,.25)" }} />Stage {progress.current.n} of 7 · {progress.current.label}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <JobTitle job={job} onRename={onRename} headingLevel={headingLevel} />
            {payment}
          </div>
          <JobAddress job={job} onEditAddress={onEditAddress} />
          <JobInfo snap={snap} folder={folder} />
        </div>
        <div className="grid w-[380px] max-w-full shrink-0 gap-2 max-[1100px]:w-full max-[1100px]:grid-cols-2 max-[699px]:grid-cols-1">
          <SuperBox compact jobId={job.id} jobContacts={jobContacts} events={events} />
          <HomeownerBox compact job={job} jobContacts={jobContacts} />
        </div>
      </div>

      {/* Footer bar: where the job stands on the left, the actions on the right. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-b-[14px] px-6 py-3 max-[699px]:px-4" style={{ backgroundColor: "rgba(255,255,255,.05)", borderTop: "1px solid rgba(255,255,255,.09)" }}>
        <div className="flex min-w-0 flex-1 basis-[320px] flex-wrap items-center gap-2.5">
          {proj ? (
            <>
              <span className="shrink-0 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: "rgba(224,201,148,.2)", color: BRASS_LT }}>Next visit</span>
              <span className="shrink-0 font-mono-num text-[14px] font-semibold whitespace-nowrap" style={{ color: HERO_INK }}>{proj.line}</span>
              <p className="m-0 min-w-0 flex-1 text-[14.5px] font-semibold leading-[20px] max-[699px]:w-full max-[699px]:flex-none" style={{ color: HERO_INK }}>
                {proj.expandable && heroExpanded ? proj.purposeFull : proj.purposePreview}
                {proj.expandable ? <button type="button" onClick={() => setHeroExpanded((v) => !v)} className="ml-1.5 text-[12px] font-semibold hover:underline" style={{ color: BRASS_LT }}>{heroExpanded ? "Show less" : "Show more"}</button> : null}
              </p>
            </>
          ) : (
            <>
              <span className="shrink-0 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: chipBg, color: chipInk }}>{snap.step.tag}</span>
              <p className="m-0 min-w-0 flex-1 text-[15px] font-semibold leading-[21px]" style={{ color: HERO_INK }}>
                {lead}{rest.length ? <span className="font-medium" style={{ color: HERO_MUTED }}> {rest.join(" ")}</span> : null}
              </p>
            </>
          )}
        </div>
        <div className="hero-actions flex min-w-0 flex-wrap items-center gap-2">
          <button type="button" onClick={onFieldReport} className={HERO_BTN} style={{ backgroundColor: BRASS, color: "#1d160a" }}><Camera className="h-[15px] w-[15px]" />Field report</button>
          <FilesMenu folder={folder} plans={plans} events={events} />
          {extra}
        </div>
      </div>
    </section>
  );
}

export const heroLinkClass = HERO_BTN;
export const heroLinkStyle = HERO_SEC;

// ---------- "The job" and "Scope" ----------

export function JobFactsCard({ snap, folder }) {
  const pos = snap.refs.filter((r) => r.startsWith("PO ")).map((r) => r.slice(3));
  const oes = snap.refs.filter((r) => r.startsWith("OE ")).map((r) => r.slice(3));
  const ref = (list) => (list.length ? <span className="font-mono text-[14px] font-medium" title={list.join(", ")}>{list[0]}{list.length > 1 ? <span style={{ color: MUTED }}> +{list.length - 1}</span> : null}</span> : <span style={{ color: MUTED, fontWeight: 500 }}>—</span>);
  // The next / last visit is already the headline of the hero's action bar, so it is not
  // repeated here; this card holds the reference facts that appear nowhere else.
  const cells = [
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
      <dl className="-ml-px -mt-px grid grid-cols-4 max-[1100px]:grid-cols-2">
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
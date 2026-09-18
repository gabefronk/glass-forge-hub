import { useState } from "react";
import { Link } from "react-router-dom";
import { Phone, Mail, HardHat, User, AlertTriangle, Lightbulb } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { CONFIDENCE_LABELS, ROLE_LABELS, confirmRoleOf, groupByRole, invokeErrorOf, suggestionTitle } from "@/lib/jobContacts";

const LINK_LABELS = { saved: "Saved job link", workbook: "Matched from the workbook label" };

export function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5" style={{ borderTop: `1px solid ${C.rowBorder}` }}>
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: C.textMuted }} />
      <div className="min-w-0 flex-1">
        <div className="mono-label-sm mb-1">{label}</div>
        {children}
      </div>
    </div>
  );
}

export function ContactRow({ contact, detail }) {
  const phone = contact.phone;
  const email = contact.email;
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-medium break-words" style={{ color: C.text }}>{sanitizeText(contact.name)}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
        {phone && (
          <a href={`tel:${contact.phone_key || String(phone).replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-[12px] py-0.5 break-words hover:underline" style={{ color: C.accentText }}>
            <Phone className="h-3 w-3 shrink-0" />{phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${contact.email_key || email}`} className="inline-flex items-center gap-1 text-[12px] py-0.5 break-all hover:underline" style={{ color: C.accentText }}>
            <Mail className="h-3 w-3 shrink-0" />{email}
          </a>
        )}
      </div>
      {detail && <div className="text-[11px] mt-0.5" style={{ color: C.textFaint }}>{detail}</div>}
    </div>
  );
}

function Missing({ children }) {
  return (
    <div className="inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium" style={{ backgroundColor: C.amberLight, color: C.amber }}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
      <span className="break-words">{children}</span>
    </div>
  );
}

// Linked people for the job, by role, with explicit indicators when nobody (or no superintendent) is linked.
// Builder-level contacts are drawn by the caller next to the builder name.
export function JobContactRows({ jobId, jobContacts }) {
  const { phase, view, error, reload } = jobContacts || {};
  if (!jobContacts || phase === "private" || phase === "idle") return null;
  if (phase === "loading") {
    return <Row icon={HardHat} label="Superintendent"><p className="text-[12px]" style={{ color: C.textMuted }}>Loading contacts…</p></Row>;
  }
  if (phase === "error") {
    return (
      <Row icon={HardHat} label="Contacts">
        <p role="alert" className="text-[12px] break-words" style={{ color: "#A43432" }}>Contacts could not load. {error}</p>
        <button type="button" onClick={reload} className="mt-1 text-[12px] underline" style={{ color: C.accentText }}>Retry</button>
      </Row>
    );
  }
  const linked = view.linked || [];
  const supers = linked.filter((c) => c.role === "superintendent");
  const suggestedSupers = (view.suggestions || []).filter((s) => s.role === "superintendent").length;
  const others = groupByRole(linked).filter(([role]) => role !== "superintendent" && role !== "builder");
  const contactsHref = `/contacts?job=${encodeURIComponent(jobId)}`;
  return (
    <>
      <Row icon={HardHat} label="Superintendent">
        {supers.length > 0 ? (
          <div className="space-y-1.5">{supers.map((c) => <ContactRow key={c.key} contact={c} detail={LINK_LABELS[c.link]} />)}</div>
        ) : (
          <Missing>No superintendent linked{suggestedSupers > 0 ? ` · ${suggestedSupers} suggested below` : ""}</Missing>
        )}
      </Row>
      {others.map(([role, list]) => (
        <Row key={role} icon={role === "project_manager" ? HardHat : User} label={ROLE_LABELS[role]}>
          <div className="space-y-1.5">{list.map((c) => <ContactRow key={c.key} contact={c} detail={LINK_LABELS[c.link]} />)}</div>
        </Row>
      ))}
      {view.status?.missing_contact && (
        <Row icon={AlertTriangle} label="Contacts">
          <Missing>No contacts linked to this job yet (0 linked)</Missing>
          <p className="mt-1 text-[12px] break-words" style={{ color: C.textMuted }}>
            {view.directory ? "Nothing has been guessed or saved. " : "The contacts directory has not been imported yet. "}
            <Link to={contactsHref} className="underline" style={{ color: C.accentText }}>Find people in Contacts</Link>
          </p>
        </Row>
      )}
    </>
  );
}

function SuggestionCard({ suggestion: s, onConfirm }) {
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const role = confirmRoleOf(s);
  const people = s.contact ? [{ ...s.contact, already_linked: s.already_linked }] : s.candidates || [];
  const confirm = async (key) => {
    setBusy(true);
    setError("");
    try {
      await onConfirm({ contactKey: key, role });
      setPending("");
    } catch (e) {
      setError(invokeErrorOf(e).message || "The link could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const missingWho = s.seed ? `${s.seed.name}${s.seed.phone ? ` (${s.seed.phone})` : ""}` : "this number or email";
  return (
    <li className="rounded-lg p-2.5" style={{ border: `1px dashed ${C.borderStrong}`, backgroundColor: C.cardAlt }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-semibold break-words" style={{ color: C.text }}>{sanitizeText(suggestionTitle(s))}</span>
        {s.role && ROLE_LABELS[s.role] && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ backgroundColor: C.tagCal.bg, color: C.tagCal.text }}>{ROLE_LABELS[s.role]}</span>}
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ backgroundColor: C.tagReview.bg, color: C.tagReview.text }}>{CONFIDENCE_LABELS[s.confidence] || s.confidence}</span>
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] break-words" style={{ color: C.textSecondary }}>
        {s.reasons.map((r) => <li key={r}>{r}</li>)}
        {s.seed?.note && <li>{s.seed.note}</li>}
      </ul>
      {people.length > 0 ? (
        <div className="mt-2 space-y-2">
          {s.candidates?.length > 0 && <p className="text-[11px]" style={{ color: C.textMuted }}>Possible directory {s.candidates.length === 1 ? "match" : "matches"}. Link only the right person:</p>}
          {people.map((c) => (
            <div key={c.key} className="rounded-md bg-white p-2" style={{ border: `1px solid ${C.rowBorder}` }}>
              <ContactRow contact={c} detail={c.company} />
              {pending === c.key ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[12px]" style={{ color: C.text }}>Save {sanitizeText(c.name)}{role ? " as superintendent" : ""} for this job?</span>
                  <button type="button" disabled={busy} onClick={() => confirm(c.key)} className="rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-50" style={{ backgroundColor: C.accent, color: C.accentDark }}>{busy ? "Saving…" : "Save link"}</button>
                  <button type="button" disabled={busy} onClick={() => setPending("")} className="text-[12px] underline" style={{ color: C.textSecondary }}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => { setPending(c.key); setError(""); }} className="mt-1.5 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ border: `1px solid ${C.border}`, color: C.accentText }}>
                  {c.already_linked ? "Mark as superintendent" : "Link to this job…"}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-[12px] break-words" style={{ color: C.amber }}>
          Not in the contacts directory. Add {missingWho} to the contacts workbook and re-import it, then link them here.
        </p>
      )}
      {error && <p role="alert" className="mt-1 text-[12px] break-words" style={{ color: "#A43432" }}>{error}</p>}
    </li>
  );
}

// Proposed job ⇄ contact links. Nothing is saved until the owner clicks "Link…" and then "Save link".
export function ContactSuggestions({ suggestions, onConfirm }) {
  if (!suggestions?.length) return null;
  return <ul className="space-y-2">{suggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} onConfirm={onConfirm} />)}</ul>;
}

export function JobContactSuggestionsRow({ jobContacts }) {
  const { phase, view, confirmLink } = jobContacts || {};
  if (!view || (phase !== "ready" && phase !== "refreshing")) return null;
  if (view.legacy) {
    return (
      <Row icon={Lightbulb} label="Suggested contacts">
        <p className="text-[12px]" style={{ color: C.textMuted }}>Suggestions appear once the updated contacts function is published.</p>
      </Row>
    );
  }
  if (!view.suggestions.length && view.messages !== "unavailable") return null;
  return (
    <Row icon={Lightbulb} label={`Suggested contacts · not saved (${view.suggestions.length})`}>
      {view.messages === "unavailable" && <p className="mb-1.5 text-[11px]" style={{ color: C.textMuted }}>Message threads could not be checked for this job.</p>}
      <ContactSuggestions suggestions={view.suggestions} onConfirm={confirmLink} />
    </Row>
  );
}

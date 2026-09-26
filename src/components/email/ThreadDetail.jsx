import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { C } from "@/lib/feeUI";
import { CATEGORY_KEYS, categoryLabel, errorText } from "@/lib/emailInbox";
import { emailCall } from "@/components/email/emailApi";

// Message bodies keep their line breaks and clamp to a few lines with Show more.
function MessageText({ text, maxLines = 8 }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (expanded) { setClamped(false); return; }
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded, maxLines]);
  if (!text) return <p className="m-0 text-[12.5px] italic" style={{ color: C.textFaint }}>No text in this message.</p>;
  return (
    <div>
      <div ref={ref} className="whitespace-pre-wrap break-words text-[13px] leading-[20px]" style={expanded ? { color: C.text } : { color: C.text, display: "-webkit-box", WebkitLineClamp: maxLines, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{text}</div>
      {clamped || expanded ? <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 min-h-8 text-[12.5px] font-semibold hover:underline" style={{ color: C.accentText }}>{expanded ? "Show less" : "Show more"}</button> : null}
    </div>
  );
}

const when = (v) => (v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : n ? `${n} B` : "");

// Expanded view under a thread row: the conversation (loaded on first open) plus the
// agent's summary, next step and a category select for reclassifying.
export default function ThreadDetail({ thread, onAction, busy }) {
  const [state, setState] = useState({ loading: true, messages: [], error: "" });
  useEffect(() => {
    let active = true;
    setState({ loading: true, messages: [], error: "" });
    emailCall({ action: "thread", id: thread.id })
      .then((r) => { if (active) setState({ loading: false, messages: r.messages || [], error: "" }); })
      .catch((e) => { if (active) setState({ loading: false, messages: [], error: errorText(e, "This conversation could not be loaded.") }); });
    return () => { active = false; };
  }, [thread.id]);

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: C.rowBorder }} onClick={(e) => e.stopPropagation()}>
      {(thread.summary || thread.next_step) ? (
        <div className="mb-3 rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: "var(--gf-teal-050)", color: C.text }}>
          {thread.summary ? <p className="m-0"><span className="font-semibold">Summary: </span>{thread.summary}</p> : null}
          {thread.next_step ? <p className="m-0 mt-1"><span className="font-semibold">Next step: </span>{thread.next_step}</p> : null}
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: C.textMuted }}>
        <label className="inline-flex items-center gap-2">Category
          <select value={thread.category || ""} disabled={busy} aria-label="Thread category" onChange={(e) => onAction({ action: "set_category", id: thread.id, category: e.target.value }, { category: e.target.value })}
            className="min-h-11 sm:min-h-9 rounded-[9px] bg-white px-2 text-[12.5px] font-medium" style={{ border: `1px solid ${C.border}`, color: C.text }}>
            {!thread.category ? <option value="">Uncategorized</option> : null}
            {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{categoryLabel(k)}</option>)}
          </select>
        </label>
        {thread.job_match_confidence != null && !thread.job_id ? <span>Job match confidence {Math.round(Number(thread.job_match_confidence) * 100)}%</span> : null}
        {thread.message_count ? <span>{thread.message_count} {thread.message_count === 1 ? "message" : "messages"}</span> : null}
      </div>
      {state.error ? <p role="alert" className="text-[12.5px]" style={{ color: "var(--gf-error)" }}>{state.error}</p> : null}
      {state.loading ? <p className="text-[12.5px]" style={{ color: C.textMuted }}>Loading conversation…</p> : null}
      {!state.loading && !state.error && !state.messages.length ? <p className="text-[12.5px]" style={{ color: C.textFaint }}>No messages were stored for this thread.</p> : null}
      <ol className="m-0 list-none space-y-2 p-0">
        {state.messages.map((m) => {
          const out = m.direction === "outgoing" || m.direction === "outbound" || m.direction === "sent";
          return (
            <li key={m.id} className="rounded-[10px] px-3 py-2.5" style={{ backgroundColor: out ? C.accent06 : C.card, border: `1px solid ${C.rowBorder}` }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="min-w-0 truncate text-[12.5px] font-semibold" style={{ color: C.text }}>{out ? "You" : m.from_name || m.from_email || "Unknown sender"}{!out && m.from_email && m.from_name ? <span className="font-normal" style={{ color: C.textMuted }}> · {m.from_email}</span> : null}</span>
                <span className="text-[11px] tabular-nums" style={{ color: C.textFaint }}>{when(m.sent_at)}</span>
              </div>
              {m.to?.length ? <div className="mt-0.5 truncate text-[11px]" style={{ color: C.textFaint }}>to {m.to.map((t) => (typeof t === "string" ? t : t?.name || t?.email)).filter(Boolean).join(", ")}</div> : null}
              <div className="mt-1.5"><MessageText text={m.text} /></div>
              {m.attachments?.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5 p-0">
                  {m.attachments.map((a, i) => <li key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]" style={{ backgroundColor: C.mutedBg, color: C.mutedText, border: `1px solid ${C.rowBorder}` }}><Paperclip className="h-3 w-3" />{a.name || "attachment"}{a.size ? ` · ${kb(a.size)}` : ""}</li>)}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

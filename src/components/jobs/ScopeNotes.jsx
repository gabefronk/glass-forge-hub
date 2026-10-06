import { useState } from "react";
import { sanitizeText } from "@/lib/jobsSanitize";

const INK = "#101617", MUTED = "#616a6d";

// Renders parseScopeNotes() output: tags, plain notes, a quantity list, then a
// small row of reference facts. limit: how many notes + items show before
// "Show all" (0 = everything).
export default function ScopeNotes({ parsed, limit = 0, size = "md" }) {
  const [all, setAll] = useState(false);
  if (!parsed) return null;
  const { tags, notes, items, facts } = parsed;
  const total = notes.length + items.length;
  const cut = limit && !all && total > limit;
  const shownNotes = cut ? notes.slice(0, limit) : notes;
  const shownItems = cut ? items.slice(0, Math.max(0, limit - shownNotes.length)) : items;
  const text = size === "sm" ? "text-[14px] leading-[21px]" : "text-[14.5px] leading-[22px]";
  return (
    <div className="flex flex-col gap-2.5">
      {tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-[6px] px-2 py-0.5 text-[11.5px] font-semibold tracking-[.02em]" style={{ backgroundColor: "#f6efe0", color: "#6f4e10", border: "1px solid #e8d9b5" }}>{t.split(" · ").map((x) => sanitizeText(x)).join(" · ")}</span>
          ))}
        </div>
      ) : null}
      {shownNotes.length ? (
        <div className="flex flex-col gap-1">
          {shownNotes.map((n, i) => <p key={i} className={`m-0 ${text} break-words`} style={{ color: INK }}>{sanitizeText(n)}</p>)}
        </div>
      ) : null}
      {shownItems.length ? (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] p-0" style={{ border: "1px solid #eee9e0" }}>
          {shownItems.map((it, i) => (
            <li key={i} className={`flex items-center gap-3 px-3 py-2 ${i ? "border-t" : ""}`} style={{ borderColor: "#eee9e0", backgroundColor: i % 2 ? "#fcfbf8" : "#fff" }}>
              <span className="flex h-6 min-w-[34px] shrink-0 items-center justify-center rounded-[6px] font-mono text-[12.5px] font-semibold" style={{ backgroundColor: "#e2eeeb", color: "#082f2c" }}>{it.qty}×</span>
              <span className={`min-w-0 flex-1 ${text} font-medium break-words`} style={{ color: INK }}>{sanitizeText(it.text)}</span>
              {it.line ? <span className="shrink-0 font-mono text-[11.5px]" style={{ color: MUTED }}>line {it.line}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {cut ? (
        <button type="button" onClick={() => setAll(true)} className="w-fit text-[12.5px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Show all {total}</button>
      ) : null}
      {facts.length ? (
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1.5 pt-0.5">
          {facts.map((f) => (
            <div key={`${f.k}${f.v}`} className="flex items-baseline gap-1.5">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[.1em]" style={{ color: MUTED }}>{f.k}</dt>
              <dd className="m-0 font-mono text-[13px]" style={{ color: "#34403f" }}>{sanitizeText(f.v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

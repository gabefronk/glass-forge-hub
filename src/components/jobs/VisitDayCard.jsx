import { useMemo, useState } from "react";
import { HardHat, ShoppingCart, Package, CalendarClock, Paperclip } from "lucide-react";
import { crewName } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { visitFields, visibleNotes } from "@/lib/visitFields";
import ClampedText from "./ClampedText";
import PhotoStrip from "./PhotoStrip";
import { ServiceItemPanel } from "./ServiceItems";

// The job page's Visits, one card per date: a quiet date stamp, the stage(s) that happened
// that day, then that day's entries. Upcoming dates are gold and dashed; the latest stage
// is the bright green one. Every string from notes passes through sanitizeText, so dollar
// figures stay off this page exactly as before.

const INK = "#101617", MUTED = "#616a6d", INK2 = "#566063", HAIR = "#eee9e0", BORDER = "#d3cabb", BAND = "#faf8f3";
const TEAL = "#0b3f3b", TEAL8 = "#082f2c", TEAL050 = "#eef5f3", MINT = "#cfe3da", SAGE_EDGE = "#6f9d93";
const BRASS = "#b8955a", BRASS3 = "#e0c994", AMBER7 = "#6f4e10", AMBER050 = "#faf0da", AMBER100 = "#efdfb7";
const GREEN = "#2f9e5f", GREEN_INK = "#1f7a45";

const clean = (s) => sanitizeText(s);
const utc = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

export function dayStamp(date, today) {
  const dt = new Date(utc(date));
  const wd = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const mo = dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const diff = today ? Math.round((utc(date) - utc(today)) / 86400000) : null;
  const rel = diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : diff > 1 && diff <= 30 ? `In ${diff} days` : "";
  return { wd, day: dt.getUTCDate(), mo, rel, future: diff != null && diff > 0 };
}

export function MonthRule({ date, today }) {
  const dt = new Date(utc(date));
  const sameYear = !today || today.slice(0, 4) === date.slice(0, 4);
  const label = dt.toLocaleDateString("en-US", { month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
  return (
    <div className="mb-3 mt-6 flex items-center gap-2.5 first:mt-0">
      <span className="text-[12px] font-bold uppercase tracking-[.14em]" style={{ color: "#3e5a55" }}>{label}</span>
      <span className="h-px flex-1" style={{ backgroundColor: "#cdbf9f" }} />
    </div>
  );
}

function StageBar({ stages }) {
  const current = stages.some((s) => s.current);
  const n = stages.map((s) => s.n);
  const range = n.length > 1 ? `${Math.min(...n)}–${Math.max(...n)}` : n[0];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-2.5 max-[599px]:mb-0 max-[599px]:px-3.5 max-[599px]:py-2.5" style={{ borderColor: HAIR, backgroundColor: current ? "rgba(238,248,241,.6)" : undefined }}>
      <span className="text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: current ? GREEN_INK : INK2 }}>{current ? "Current stage" : "Milestone"}</span>
      {stages.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold"
          style={s.current ? { backgroundColor: GREEN, color: "#fff", border: `1px solid ${GREEN}` } : { backgroundColor: TEAL050, color: TEAL8, border: `1px solid ${MINT}` }}>
          <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: s.current ? "#fff" : SAGE_EDGE }} />{s.label}
        </span>
      ))}
      <span className="ml-auto text-[12px] font-semibold" style={{ color: MUTED }}>Stage {range} of 7</span>
    </div>
  );
}

// One date. stages: progress.byDate[date] (may be undefined).
export function DayCard({ date, today, stages, children }) {
  const s = dayStamp(date, today);
  const isStage = !!stages?.length;
  const isCurrent = isStage && stages.some((x) => x.current);
  const shell = s.future
    ? { backgroundColor: AMBER050, border: `1.5px dashed ${BRASS}` }
    : isCurrent
      ? { backgroundColor: "#fff", backgroundImage: "linear-gradient(90deg,#eef8f1,#fff 55%)", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${GREEN}`, boxShadow: "0 0 0 1px rgba(47,158,95,.22),0 10px 24px -14px rgba(47,158,95,.5)" }
      : { backgroundColor: "#fff", border: `1px solid ${BORDER}`, borderLeft: isStage ? `4px solid ${SAGE_EDGE}` : `1px solid ${BORDER}`, boxShadow: "0 1px 2px rgba(10,29,31,.06),0 8px 18px -12px rgba(10,29,31,.22)" };
  const stampInk = s.future ? AMBER7 : isCurrent ? GREEN_INK : isStage ? TEAL8 : INK;
  return (
    <section className="mb-3.5 grid grid-cols-[72px_minmax(0,1fr)] gap-x-[18px] rounded-[14px] px-[18px] py-4 max-[599px]:grid-cols-1 max-[599px]:overflow-hidden max-[599px]:p-0" style={shell} aria-label={`${s.wd} ${s.mo} ${s.day}`}>
      <div className="self-start border-r pr-3 text-center max-[599px]:flex max-[599px]:items-baseline max-[599px]:gap-1.5 max-[599px]:border-b max-[599px]:border-r-0 max-[599px]:px-3.5 max-[599px]:py-2 max-[599px]:text-left"
        style={{ borderColor: s.future ? BRASS : isCurrent ? "#bfe3cc" : HAIR }}>
        {s.rel ? <span className="mb-1.5 block rounded-[5px] px-1 py-0.5 text-[9.5px] font-bold uppercase tracking-[.06em] max-[599px]:order-4 max-[599px]:mb-0 max-[599px]:ml-auto" style={s.future ? { backgroundColor: AMBER100, color: AMBER7 } : { backgroundColor: TEAL050, color: "#10524c" }}>{s.rel}</span> : s.future ? <span className="mb-1.5 block rounded-[5px] px-1 py-0.5 text-[9.5px] font-bold uppercase tracking-[.06em] max-[599px]:order-4 max-[599px]:mb-0 max-[599px]:ml-auto" style={{ backgroundColor: AMBER100, color: AMBER7 }}>Upcoming</span> : null}
        <span className="block text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: s.future ? AMBER7 : INK2 }}>{s.wd}</span>
        <span className="my-px block text-[24px] font-semibold leading-none tracking-[-.02em] max-[599px]:order-2 max-[599px]:text-[15px]" style={{ color: stampInk }}>{s.day}</span>
        <span className="block text-[10.5px] font-semibold uppercase tracking-[.12em] max-[599px]:order-3" style={{ color: s.future ? AMBER7 : INK2 }}>{s.mo}</span>
      </div>
      <div className="min-w-0">
        {isStage ? <StageBar stages={stages} /> : null}
        <div className="flex flex-col gap-4 divide-y divide-dashed max-[599px]:gap-0 max-[599px]:px-3.5 max-[599px]:py-3 [&>*+*]:pt-4" style={{ borderColor: "#e0dacf" }}>{children}</div>
      </div>
    </section>
  );
}

// The next stage when nothing is booked for it yet.
export function UpNextCard({ next }) {
  if (!next || next.booked) return null;
  return (
    <section className="mb-3.5 flex flex-wrap items-center gap-3 rounded-[14px] px-[18px] py-3.5" style={{ border: "1.5px dashed #b9a98a" }}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ border: "1px dashed #b9a98a", color: MUTED }}><CalendarClock className="h-[15px] w-[15px]" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: INK2 }}>Up next · stage {next.n} of 7</div>
        <div className="text-[15px] font-bold" style={{ color: INK }}>{next.label} <span className="text-[13px] font-medium" style={{ color: MUTED }}>— not on the calendar yet</span></div>
      </div>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3.5 max-[599px]:grid-cols-1">
      <dt className="pt-[3px] text-[10.5px] font-semibold uppercase tracking-[.12em] max-[599px]:pt-1" style={{ color: INK2 }}>{label}</dt>
      <dd className="m-0 min-w-0 text-[14.5px] leading-[1.5] break-words" style={{ color: INK }}>{children}</dd>
    </div>
  );
}

function Bullets({ items }) {
  if (items.length === 1) return <span>{items[0]}</span>;
  return (
    <ul className="m-0 list-none p-0">
      {items.map((t, i) => (
        <li key={i} className="relative mb-1 pl-4 last:mb-0"><span className="absolute left-0.5 top-[9px] h-1.5 w-1.5 rounded-[2px]" style={{ backgroundColor: BRASS }} />{t}</li>
      ))}
    </ul>
  );
}

// Plain "Key value · Key value" line for the leftover details (install type, VPO, parts ETA…).
function InlineDetails({ cells }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {cells.map(([k, v], i) => (
        <span key={`${k}${i}`}><span className="text-[12.5px]" style={{ color: MUTED }}>{k}</span> <span className="font-semibold">{v}</span></span>
      ))}
    </span>
  );
}

// Calendar attachments as links. An install-method sheet gets a plain name; the full file
// name stays in the tooltip.
const METHOD_RE = /install(ation)?\s*(method|type)|sill pan|nail-on|typar|tyvek|\bzip\b/i;
function fileName(title) {
  const t = String(title || "Attachment").replace(/\.pdf$/i, "").replace(/^new\s+/i, "").trim();
  return METHOD_RE.test(t) ? "Install method sheet" : t;
}
function Files({ files }) {
  return (
    <span className="flex flex-col gap-0.5">
      {files.map((a, i) => (
        <a key={i} href={a.drive_url || a.file_url} target="_blank" rel="noreferrer" title={a.title} className="inline-flex w-fit items-center gap-1.5 text-[13.5px] font-semibold hover:underline" style={{ color: TEAL }}>
          <Paperclip className="h-3.5 w-3.5 shrink-0" style={{ color: MUTED }} />{clean(fileName(a.title))}{/\.pdf$/i.test(a.title || "") ? <span className="text-[11.5px] font-medium" style={{ color: MUTED }}>PDF</span> : null}
        </a>
      ))}
    </span>
  );
}

function Chip({ children, tone = "sand" }) {
  const tones = { sand: ["#f1e8d6", AMBER7, AMBER100], teal: [TEAL050, TEAL8, MINT], amber: [AMBER050, AMBER7, AMBER100] };
  const [bg, ink, bd] = tones[tone] || tones.sand;
  return <span className="inline-flex items-center rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: bg, color: ink, border: `1px solid ${bd}` }}>{children}</span>;
}

const joinMeta = (...parts) => parts.filter(Boolean).join(" · ");

// One calendar visit, laid out as rows. badge: the visit's report pill from the feed.
// services: the service items this visit is the fix for (their service_event_id). The item is
// tracked here — one place — and the report it came from just points to it.
export function VisitEntry({ ev, reports = [], badge, onPhotoClick, services = [], onServiceChanged }) {
  const f = useMemo(() => visitFields(ev), [ev]);
  const [showOther, setShowOther] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const list = (arr) => arr.map(clean).filter(Boolean);
  const work = list(f.work);
  const headsUp = list(f.headsUp);
  const result = list(f.result);
  const other = list(f.other);
  const issues = f.issues.map((i) => ({ ...i, text: clean(i.text) })).filter((i) => i.text);
  const people = f.people.map((p) => ({ ...p, text: clean(p.text) })).filter((p) => p.text);
  const multiVendor = f.vendors.filter((v) => v.qty != null).length > 1;
  // Product: qty, how it's delivered, when it got to BFS — one plain line.
  const deliveryText = f.delivery ? clean(joinMeta(f.delivery.method.replace(/^To BFS$/, "to BFS"), f.delivery.date)) : "";
  const product = multiVendor ? "" : joinMeta(
    f.qty ? `Qty ${f.qty}` : "",
    deliveryText,
    f.received.length ? `at BFS ${clean(f.received[f.received.length - 1])}` : "",
  );
  const cells = f.details.map((d) => [d.k, clean(d.v)]).filter((c) => c[1]);
  const files = (ev.event_attachments || []).filter((a) => a?.file_url || a?.drive_url);
  const time = ev.start_time ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : "All day";
  const photos = reports.reduce((n, r) => n + (r.photos?.length || 0), 0);
  const meta = joinMeta(time, crewName(ev.created_by), photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : "");
  const original = clean(visibleNotes(ev)).trim();
  const Icon = f.type === "order" ? ShoppingCart : HardHat;
  // Brand leads the title ("Andersen install visit"); a visit booked for a service item is a service visit.
  const label = services.length ? "Service visit" : f.label;
  const brand = clean(f.brand || "");
  const title = brand && f.type !== "order" ? `${brand} ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  const chips = [...new Set(f.tags.map(clean).filter((t) => t && t !== brand))];

  return (
    <article className="min-w-0">
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ backgroundColor: TEAL050, color: TEAL, border: `1px solid ${MINT}` }}><Icon className="h-[15px] w-[15px]" /></span>
        <div className="min-w-0 flex-1">
          <h4 className="m-0 flex flex-wrap items-center gap-1.5 text-[15.5px] font-bold leading-tight" style={{ color: INK }}>{title}{chips.map((c) => <Chip key={c} tone="teal">{c}</Chip>)}</h4>
          <div className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>{meta}</div>
        </div>
        {badge ? <span className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span> : null}
      </div>
      <dl className="m-0 mt-3 flex flex-col gap-2.5 pl-[38px] max-[599px]:pl-0">
        {issues.length ? (
          <Row label="Issue">
            <ul className="m-0 list-none p-0">{issues.map((i, k) => <li key={k} className="mb-1 last:mb-0">{i.text}{i.line ? <span className="ml-1.5 font-mono text-[11.5px]" style={{ color: MUTED }}>line {i.line}</span> : null}</li>)}</ul>
          </Row>
        ) : null}
        {work.length ? <Row label="Work"><Bullets items={work} /></Row> : null}
        {multiVendor ? (
          <Row label="Product">
            <table className="w-full max-w-[420px] border-collapse overflow-hidden rounded-[9px] text-[13.5px]" style={{ border: `1px solid ${HAIR}` }}>
              <thead><tr style={{ backgroundColor: BAND }}>{["Vendor", "Qty", "At BFS"].map((h) => <th key={h} className="border-b px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[.1em]" style={{ color: INK2, borderColor: HAIR }}>{h}</th>)}</tr></thead>
              <tbody>{f.vendors.filter((v) => v.qty != null).map((v, i) => <tr key={i}><td className="border-b px-3 py-1.5 font-semibold" style={{ borderColor: HAIR }}>{v.brand || "—"}</td><td className="border-b px-3 py-1.5" style={{ borderColor: HAIR }}>{v.qty}</td><td className="border-b px-3 py-1.5" style={{ borderColor: HAIR }}>{clean(v.here) || "—"}</td></tr>)}</tbody>
            </table>
          </Row>
        ) : null}
        {product ? <Row label="Product">{product}</Row> : null}
        {cells.length ? <Row label="Details"><InlineDetails cells={cells} /></Row> : null}
        {f.moves.length ? <Row label="Moved"><ul className="m-0 list-none p-0 text-[13.5px]" style={{ color: MUTED }}>{f.moves.map((m, i) => <li key={i} className={i === f.moves.length - 1 ? "font-semibold" : ""} style={i === f.moves.length - 1 ? { color: INK } : undefined}>{clean(m)}</li>)}</ul></Row> : null}
        {headsUp.length ? <Row label="Heads up"><span className="font-medium" style={{ color: AMBER7 }}><Bullets items={headsUp.map((h) => h.charAt(0).toUpperCase() + h.slice(1))} /></span></Row> : null}
        {files.length ? <Row label="Files"><Files files={files} /></Row> : null}
        {reports.length ? (
          <Row label="Report">
            {reports.map((r, i) => (
              <div key={r.post_id || i} className={i ? "mt-3" : ""}>
                {r.message ? <div className="border-l-[3px] pl-3" style={{ borderColor: MINT }}><ClampedText text={r.message} maxLines={4} className="text-[14.5px] leading-[21px] whitespace-pre-wrap break-words" style={{ color: INK }} /></div>
                  : <span className="text-[13.5px]" style={{ color: MUTED }}>Photos only, no notes.</span>}
                <PhotoStrip urls={r.photos} onPhotoClick={onPhotoClick} className="mt-2" />
              </div>
            ))}
          </Row>
        ) : null}
        {people.length ? <Row label="People"><ul className="m-0 list-none p-0">{people.map((p, i) => <li key={i} className="mb-0.5"><span className="text-[12px] font-semibold" style={{ color: INK2 }}>{p.role}:</span> {p.text}</li>)}</ul></Row> : null}
        {result.length ? <Row label="Result"><Bullets items={result} /></Row> : null}
        {other.length ? (
          <Row label="Other">
            {showOther ? <Bullets items={other} /> : <button type="button" onClick={() => setShowOther(true)} className="text-[12.5px] font-semibold hover:underline" style={{ color: TEAL }}>Show {other.length} more {other.length === 1 ? "note" : "notes"}</button>}
          </Row>
        ) : null}
      </dl>
      {services.length ? (
        <div className="pl-[38px] max-[599px]:pl-0">
          {services.map((s) => <ServiceItemPanel key={s.id} item={s} withReport={false} onChanged={onServiceChanged} />)}
        </div>
      ) : null}
      {original ? (
        <div className="mt-2 pl-[38px] max-[599px]:pl-0">
          <button type="button" onClick={() => setShowOriginal((v) => !v)} className="text-[12px] font-semibold hover:underline" style={{ color: MUTED }}>{showOriginal ? "Hide original calendar notes" : "Original calendar notes"}</button>
          {showOriginal ? <p className="m-0 mt-1.5 whitespace-pre-wrap rounded-[9px] px-3 py-2 font-mono text-[12px] leading-[1.55]" style={{ backgroundColor: BAND, color: "#34403f", border: `1px solid ${HAIR}` }}>{original.replace(/\n{3,}/g, "\n\n")}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

// A stage that happened on a day with nothing else logged (e.g. product arrived at BFS).
export function StageOnlyEntry({ stages }) {
  const words = { received: "Product received at BFS", delivered: "Delivered to the jobsite", ordered: "Order placed", installed: "Installed" };
  return (
    <article className="flex items-start gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ backgroundColor: "#e8eee4", color: "#3b5a3a", border: "1px solid #d3dfcc" }}><Package className="h-[15px] w-[15px]" /></span>
      <div className="min-w-0">
        <h4 className="m-0 text-[15.5px] font-bold leading-tight" style={{ color: INK }}>{stages.map((s) => words[s.key] || s.label).join(" · ")}</h4>
        <div className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>From the dates in the calendar notes</div>
      </div>
    </article>
  );
}

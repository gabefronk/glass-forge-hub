import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, SlidersHorizontal } from "lucide-react";

const SECTION = "px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[.12em]";

function Option({ on, label, count, attention, onClick }) {
  return (
    <button type="button" role="option" aria-selected={on} onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left text-[13.5px] hover:bg-black/[0.03]"
      style={{ color: "#101617", fontWeight: on ? 700 : 500, backgroundColor: on ? "#eef5f1" : undefined }}>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{on ? <Check className="h-3.5 w-3.5" style={{ color: "#0b3f3b" }} /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 font-mono text-[12px] tabular-nums" style={{ color: attention && count ? "#8a5a12" : "#616a6d" }}>{count.toLocaleString()}</span> : null}
    </button>
  );
}

// One "Filters" button for the Jobs list: the view (Needs you, This week…),
// the builder and the sort live in a single dropdown. The button shows what
// is set and turns brass when anything is narrowed. Sits in the dark hero.
export default function QuickFilterMenu({ views, moreViews, view, onView, builders, builder, onBuilder, sorts, sort, onSort, onClear }) {
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
  const allViews = [...views, ...moreViews];
  const current = allViews.find((v) => v.key === view) || views[0];
  const sortLabel = sorts.find((s) => s.key === sort)?.label || "";
  const active = view !== "all" || Boolean(builder);
  const summary = [current?.label, builder, sortLabel].filter(Boolean).join(" · ");
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label="Filters" onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[9px] px-2.5 text-[12.5px] font-semibold"
        style={active ? { backgroundColor: "#e0c994", color: "#1d160a", border: "1px solid #e0c994" } : { backgroundColor: "rgba(255,255,255,.08)", color: "#f2eee8", border: "1px solid rgba(255,255,255,.16)" }}>
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" style={{ color: active ? "#1d160a" : "#e0c994" }} />
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <span className="shrink-0 tabular-nums" style={{ color: active ? "#4a3a17" : "#aeb5b7", fontWeight: 500 }}>{current?.count?.toLocaleString()}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: active ? "#1d160a" : "#e0c994" }} />
      </button>
      {open ? (
        <div role="dialog" aria-label="Filters" className="absolute left-0 top-[calc(100%+6px)] z-30 flex w-[520px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[12px] bg-white max-[599px]:w-[calc(100vw-40px)] max-[599px]:flex-col" style={{ border: "1px solid #e2dcd1", boxShadow: "0 18px 44px -12px rgba(21,24,26,.35),0 2px 6px rgba(21,24,26,.06)" }}>
          <div role="listbox" aria-label="Show" className="min-w-0 flex-1 pb-2 max-[599px]:border-b min-[600px]:border-r" style={{ borderColor: "#eee9e0" }}>
            <div className={SECTION} style={{ color: "#8a6420" }}>Show</div>
            {views.map((v) => <Option key={v.key} on={v.key === view} label={v.label} count={v.count} attention={v.attention} onClick={() => onView(v.key)} />)}
            <div className={SECTION} style={{ color: "#8a6420", borderTop: "1px solid #eee9e0", marginTop: 4 }}>More views</div>
            {moreViews.map((v) => <Option key={v.key} on={v.key === view} label={v.label} count={v.count} onClick={() => onView(v.key)} />)}
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <div className={SECTION} style={{ color: "#8a6420" }}>Builder</div>
            <div className="max-h-[210px] overflow-y-auto obsidian-scroll">
              <Option on={!builder} label="All builders" onClick={() => onBuilder("")} />
              {builders.map((b) => <Option key={b.name} on={builder === b.name} label={b.name} count={b.count} onClick={() => onBuilder(b.name)} />)}
            </div>
            <div className={SECTION} style={{ color: "#8a6420", borderTop: "1px solid #eee9e0", marginTop: 4 }}>Sort</div>
            {sorts.map((s) => <Option key={s.key} on={s.key === sort} label={s.label} onClick={() => onSort(s.key)} />)}
            {active ? (
              <div className="px-3.5 pt-2" style={{ borderTop: "1px solid #eee9e0", marginTop: 6 }}>
                <button type="button" onClick={() => { onClear(); setOpen(false); }} className="text-[12.5px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Clear filters</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

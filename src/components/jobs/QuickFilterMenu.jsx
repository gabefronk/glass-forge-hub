import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Filter } from "lucide-react";

// One "Quick filter" button for the Jobs list: the main views and the extra
// views in a single dropdown, each with its count. Sits in the dark hero.
export default function QuickFilterMenu({ value, groups, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const all = groups.flatMap((g) => g.items);
  const current = all.find((v) => v.key === value) || all[0];
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const active = value !== "all";
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Quick filter" onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[9px] px-2.5 text-[12.5px] font-semibold"
        style={active ? { backgroundColor: "#e0c994", color: "#1d160a", border: "1px solid #e0c994" } : { backgroundColor: "rgba(255,255,255,.08)", color: "#f2eee8", border: "1px solid rgba(255,255,255,.16)" }}>
        <Filter className="h-3.5 w-3.5 shrink-0" style={{ color: active ? "#1d160a" : "#e0c994" }} />
        <span className="min-w-0 flex-1 truncate text-left">{current?.label}</span>
        <span className="shrink-0 tabular-nums" style={{ color: active ? "#4a3a17" : "#aeb5b7", fontWeight: 500 }}>{current?.count?.toLocaleString()}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: active ? "#1d160a" : "#e0c994" }} />
      </button>
      {open ? (
        <div role="listbox" aria-label="Quick filter" className="absolute left-0 top-[calc(100%+6px)] z-30 w-[260px] overflow-hidden rounded-[12px] bg-white" style={{ border: "1px solid #e2dcd1", boxShadow: "0 18px 44px -12px rgba(21,24,26,.35),0 2px 6px rgba(21,24,26,.06)" }}>
          {groups.map((g, gi) => (
            <div key={g.title || gi} className={gi ? "border-t" : ""} style={{ borderColor: "#eee9e0" }}>
              {g.title ? <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: "#8a6420" }}>{g.title}</div> : null}
              {g.items.map((v) => {
                const on = v.key === value;
                return (
                  <button key={v.key} type="button" role="option" aria-selected={on} onClick={() => { onChange(v.key); setOpen(false); }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] hover:bg-black/[0.03]"
                    style={{ color: "#101617", fontWeight: on ? 700 : 500, backgroundColor: on ? "#eef5f1" : undefined }}>
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{on ? <Check className="h-3.5 w-3.5" style={{ color: "#0b3f3b" }} /> : null}</span>
                    <span className="min-w-0 flex-1">{v.label}</span>
                    <span className="shrink-0 font-mono text-[12px] tabular-nums" style={{ color: v.attention && v.count ? "#8a5a12" : "#616a6d" }}>{v.count.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

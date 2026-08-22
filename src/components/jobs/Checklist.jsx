import { Check } from "lucide-react";
import { C } from "@/lib/feeUI";

const ITEMS = [
  { label: "Field measurements confirmed", meta: "Verify all openings and dimensions" },
  { label: "Material order placed", meta: "PO submitted to BFS" },
  { label: "Delivery scheduled", meta: "Confirm date with site super" },
  { label: "Site prep complete", meta: "Access, forklift, power on-site" },
  { label: "Installation complete", meta: "All units set and sealed" },
  { label: "Final inspection passed", meta: "QA walkthrough with builder" },
];

export const CHECKLIST_TOTAL = ITEMS.length;

export default function Checklist({ checked, onToggle }) {
  const done = checked.size;
  const pct = CHECKLIST_TOTAL ? (done / CHECKLIST_TOTAL) * 100 : 0;

  return (
    <div className="rounded-[16px] overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
        <h2 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>Delivery &amp; install checklist</h2>
        <span className="font-mono-num text-[12px]" style={{ color: C.textMuted }}>{done} of {CHECKLIST_TOTAL}</span>
      </div>
      <div className="h-[3px]" style={{ backgroundColor: "rgba(255,255,255,.05)" }}>
        <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: C.accent }} />
      </div>
      <div>
        {ITEMS.map((item, i) => {
          const isDone = checked.has(i);
          return (
            <button
              key={i}
              onClick={() => onToggle(i)}
              className="w-full flex items-center gap-3 px-5 text-left transition-colors hover:bg-white/[0.02]"
              style={{ minHeight: "56px", borderTop: i > 0 ? `1px solid ${C.rowBorder}` : "none" }}
            >
              <div
                className="h-[26px] w-[26px] rounded-full shrink-0 flex items-center justify-center transition-all"
                style={{
                  border: isDone ? "none" : `1.5px solid rgba(255,255,255,.2)`,
                  backgroundColor: isDone ? C.accent : "transparent",
                }}
              >
                {isDone && <Check className="h-3.5 w-3.5" style={{ color: C.accentDark }} strokeWidth={3} />}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] font-semibold truncate"
                  style={{ color: C.text, textDecoration: isDone ? "line-through" : "none", opacity: isDone ? 0.5 : 1 }}
                >
                  {item.label}
                </div>
                <div className="text-[11px] truncate" style={{ color: C.textMuted }}>{item.meta}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { C } from "@/lib/feeUI";
import { SUMMIT_META } from "./summitData";

// Collapsible "Summit reference" panel shown on question / steps / info nodes.
// Reads golden rules, blink codes, DIP switch functions, and potentiometers
// from SUMMIT_META so the tech has the board context at hand without switching tabs.
export default function NodeMetaPanel({ node }) {
  const [open, setOpen] = useState(false);
  if (!node) return null;
  if (node.type === "resolved" || node.type === "call") return null;

  const { golden_rules, blink_codes, dip_switch_functions, potentiometers } = SUMMIT_META;
  const blinkEntries = Object.keys(blink_codes).filter((k) => k !== "source").map((k) => ({ n: k, v: blink_codes[k] }));
  const dipEntries = Object.keys(dip_switch_functions).filter((k) => k !== "source").map((k) => ({ n: k, v: dip_switch_functions[k] }));

  return (
    <div className="rounded-[12px] mt-4 overflow-hidden" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between w-full px-4 py-3 text-left"
        style={{ color: C.textSecondary }}
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: C.textMuted }}>Summit reference</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: C.textMuted }} />
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.textSecondary }}>Golden rules</div>
            <ul className="space-y-1.5">
              {golden_rules.map((g, i) => (
                <li key={i} className="text-[12.5px] leading-snug flex gap-2" style={{ color: C.textSecondary }}>
                  <span className="font-mono-num font-bold shrink-0" style={{ color: C.accent }}>•</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: C.textSecondary }}>Blink codes</div>
            <p className="text-[11px] leading-snug mb-2" style={{ color: C.textMuted }}>{blink_codes.source}</p>
            <ul className="space-y-1">
              {blinkEntries.map((b) => (
                <li key={b.n} className="text-[12.5px] leading-snug flex gap-2" style={{ color: C.textSecondary }}>
                  <span className="font-mono-num font-bold shrink-0" style={{ color: C.accent, minWidth: "14px" }}>{b.n}</span>
                  <span>{b.v}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: C.textSecondary }}>DIP switch functions</div>
            <p className="text-[11px] leading-snug mb-2" style={{ color: C.textMuted }}>{dip_switch_functions.source}</p>
            <ul className="space-y-1">
              {dipEntries.map((d) => (
                <li key={d.n} className="text-[12.5px] leading-snug flex gap-2" style={{ color: C.textSecondary }}>
                  <span className="font-mono-num font-bold shrink-0" style={{ color: C.accent, minWidth: "14px" }}>{d.n}</span>
                  <span>{d.v}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: C.textSecondary }}>Potentiometers</div>
            <p className="text-[11px] leading-snug mb-1" style={{ color: C.textMuted }}>{potentiometers.source}</p>
            <p className="text-[12.5px] leading-snug" style={{ color: C.text }}>{potentiometers.functions}</p>
            <p className="text-[12px] leading-snug mt-1" style={{ color: C.textSecondary }}>{potentiometers.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}
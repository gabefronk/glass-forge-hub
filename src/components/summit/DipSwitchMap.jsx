import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { C } from "@/lib/feeUI";
import { DIP_SWITCHES, SUMMIT_CARD_SHADOW } from "./summitData";
import PhotoSlot from "./PhotoSlot";

// Visual diagram of the 8 DIP switches. Tap a switch for detail + warning text.
export default function DipSwitchMap() {
  const [selected, setSelected] = useState(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
        <h3 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>DIP switch map</h3>
        <p className="text-[13px] mt-1" style={{ color: C.textSecondary }}>Tap a switch for its function and warning. Per SA-0078.</p>
        <div className="mt-3" style={{ height: 2, background: "linear-gradient(90deg, var(--gf-brass-400), transparent)", borderRadius: 2 }} />

        <div className="mt-4">
          <PhotoSlot photoKey="dip_switch_bank" />
        </div>

        {/* Diagram row of 8 switches */}
        <div className="mt-4 flex items-end justify-between gap-1.5 overflow-x-auto obsidian-scroll pb-1">
          {DIP_SWITCHES.map((d) => (
            <button
              key={d.number}
              onClick={() => setSelected(d)}
              aria-label={`DIP switch ${d.number}: ${d.name}`}
              className="flex flex-col items-center gap-2 shrink-0"
              style={{ minWidth: "44px" }}
            >
              {/* Switch body */}
              <div
                className="rounded-[6px] flex items-center justify-center font-mono-num text-[14px] font-bold"
                style={{
                  width: "44px",
                  height: "64px",
                  border: `1px solid ${C.borderStrong}`,
                  backgroundColor: C.cardAlt,
                  color: C.text,
                }}
              >
                {d.number}
              </div>
              {/* Label */}
              <span className="text-[10px] font-mono uppercase tracking-[0.05em] text-center leading-tight" style={{ color: C.textMuted }}>
                {d.name.split(" — ")[0]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Detail sheet */}
      {selected && (
        <>
          <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, zIndex: 40, backgroundColor: "rgba(24,36,34,.32)" }} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`DIP switch ${selected.number} detail`}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 41,
              backgroundColor: C.card, borderTop: `1px solid ${C.border}`,
              borderRadius: "16px 16px 0 0",
              paddingBottom: "max(16px, env(safe-area-inset-bottom))",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              boxShadow: "0 -8px 24px -12px rgba(24,36,34,.30)",
            }}
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="flex items-center justify-center rounded-full font-mono-num text-[16px] font-bold shrink-0"
                  style={{ width: "36px", height: "36px", backgroundColor: C.accent, color: C.accentDark }}
                >
                  {selected.number}
                </span>
                <h4 className="font-heading text-[17px] font-bold leading-tight" style={{ color: C.text }}>{selected.name}</h4>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-lg shrink-0" style={{ color: C.textMuted }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 pb-4">
              <p className="text-[14px] leading-snug" style={{ color: C.textSecondary }}>{selected.description}</p>
              <div className="mt-3 rounded-[10px] px-3.5 py-3 flex items-start gap-2.5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.amberLight }}>
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.amber }} />
                <p className="text-[13px] leading-snug" style={{ color: C.text }}>{selected.warning}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
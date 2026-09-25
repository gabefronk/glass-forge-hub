import { ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { DOC, SUMMIT_CARD_SHADOW, SUMMIT_META } from "./summitData";
import PhotoSlot from "./PhotoSlot";

// Potentiometer reference — reads functions, note, and source from
// SUMMIT_META.potentiometers (SA-0089). Per-pot baseline table lives in SA-0089.
export default function PotentiometerRef() {
  const pots = SUMMIT_META.potentiometers;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
        <h3 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>Potentiometer reference</h3>
        <p className="text-[13px] mt-1" style={{ color: C.textSecondary }}>Pot functions, factory note, and baseline guidance per SA-0089.</p>
        <div className="mt-3" style={{ height: 2, background: "linear-gradient(90deg, var(--gf-brass-400), transparent)", borderRadius: 2 }} />

        <div className="mt-4">
          <PhotoSlot photoKey="potentiometer_row" />
        </div>

        <div className="mt-4 rounded-[10px] px-3.5 py-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1" style={{ color: C.textMuted }}>Source</div>
          <p className="text-[12px] leading-snug" style={{ color: C.textSecondary }}>{pots.source}</p>
        </div>

        <div className="mt-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1" style={{ color: C.textMuted }}>Functions</div>
          <p className="text-[14px] leading-snug" style={{ color: C.text }}>{pots.functions}</p>
        </div>

        <div className="mt-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-1" style={{ color: C.textMuted }}>Factory note</div>
          <p className="text-[13px] leading-snug" style={{ color: C.textSecondary }}>{pots.note}</p>
        </div>

        <a
          href={DOC.sa0089.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-[10px] px-4 min-h-[48px] text-[14px] font-semibold transition-colors"
          style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.accentText }}
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          Open SA-0089 — Potentiometers
        </a>
      </div>
    </div>
  );
}
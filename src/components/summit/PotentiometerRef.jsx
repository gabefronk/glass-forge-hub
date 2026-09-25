import { ExternalLink, AlertCircle } from "lucide-react";
import { C } from "@/lib/feeUI";
import { DOC, SUMMIT_CARD_SHADOW } from "./summitData";
import PhotoSlot from "./PhotoSlot";

// Pot locations, adjustments, and baseline positions per SA-0089 (2017 & 2019
// pots manuals). The detailed baseline table is transcribed from SA-0089 —
// rendered as a clearly marked "content coming" block until transcribed.
export default function PotentiometerRef() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: SUMMIT_CARD_SHADOW }}>
        <h3 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>Potentiometer reference</h3>
        <p className="text-[13px] mt-1" style={{ color: C.textSecondary }}>
          Pot locations, what each adjusts, and baseline positions per SA-0089 (2017 and 2019 pots manuals).
        </p>
        <div className="mt-3" style={{ height: 2, background: "linear-gradient(90deg, var(--gf-brass-400), transparent)", borderRadius: 2 }} />

        <div className="mt-4">
          <PhotoSlot photoKey="potentiometer_row" />
        </div>

        {/* Content coming block — do not invent pot values */}
        <div className="mt-4 rounded-[10px] px-4 py-3.5" style={{ border: `1px dashed ${C.borderStrong}`, backgroundColor: C.amberLight }}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" style={{ color: C.amber }} />
            <span className="text-[12.5px] font-semibold" style={{ color: C.amber }}>Content coming</span>
          </div>
          <p className="text-[13px] mt-1.5 leading-snug" style={{ color: C.textSecondary }}>
            The per-pot location, adjustment, and baseline position table is being transcribed from SA-0089.
            Do not adjust pots from memory — refer to the manual until this table is published.
          </p>
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
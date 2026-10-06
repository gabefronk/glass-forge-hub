import { DoorOpen } from "lucide-react";
import { C } from "@/lib/feeUI";
import { SUMMIT_DIAGRAMS } from "./summitData";
import { Image } from "@/components/ui/image";

// Door-type diagram slot. Shows a neutral placeholder until the diagram URL is set
// in SUMMIT_DIAGRAMS. No stock or AI images — real Summit door-type diagrams only.
// variant="card" → header image with caption; variant="thumb" → small button thumbnail.
export default function DiagramSlot({ diagramKey, variant = "card", caption, label, aspect = "16 / 9" }) {
  const d = (diagramKey && SUMMIT_DIAGRAMS[diagramKey]) || {};
  const src = d.url || "";
  const cap = caption || d.caption || "";
  const lab = label || d.label || (diagramKey ? String(diagramKey) : "Door type");

  if (variant === "thumb") {
    return (
      <div
        className="rounded-[8px] overflow-hidden relative shrink-0 flex items-center justify-center"
        style={{ width: 52, height: 52, border: `1px solid ${src ? C.border : C.borderStrong}`, backgroundColor: src ? "#0E2426" : "#E9EAE5" }}
      >
        {src ? (
          <Image src={src} fittingType="fit" alt={lab} className="w-full h-full" />
        ) : (
          <DoorOpen className="h-5 w-5" style={{ color: C.textMuted }} strokeWidth={1.8} />
        )}
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-2">
      <div
        className="rounded-[12px] overflow-hidden relative w-full"
        style={{
          aspectRatio: aspect,
          border: `1px solid ${src ? C.border : C.borderStrong}`,
          backgroundColor: src ? "#0E2426" : "#E9EAE5",
          boxShadow: src ? "0 2px 10px -3px rgba(21,24,26,.22)" : "none",
        }}
      >
        {src ? (
          <Image src={src} fittingType="fit" alt={lab} className="w-full h-full" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <div className="flex items-center justify-center rounded-full" style={{ width: 38, height: 38, backgroundColor: "#D6D8D2" }}>
              <DoorOpen className="h-5 w-5" style={{ color: C.textMuted }} strokeWidth={1.8} />
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] font-semibold" style={{ color: C.textMuted }}>Diagram coming</span>
            <span className="text-[12px] font-medium leading-snug" style={{ color: C.textSecondary }}>{lab}</span>
          </div>
        )}
      </div>
      {cap && (
        <figcaption className="text-[12px] leading-snug" style={{ color: C.textMuted }}>{cap}</figcaption>
      )}
    </figure>
  );
}
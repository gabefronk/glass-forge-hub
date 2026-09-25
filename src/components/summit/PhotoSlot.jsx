import { Camera } from "lucide-react";
import { C } from "@/lib/feeUI";
import { SUMMIT_PHOTOS } from "./summitData";
import { Image } from "@/components/ui/image";

// Image slot for real job-site hardware photos. Shows a neutral "photo coming"
// placeholder until the photo URL is set in SUMMIT_PHOTOS. No stock or AI images —
// only real photos of the actual hardware, so the crew knows what they're looking at.
export default function PhotoSlot({ photoKey, caption, label, aspect = "16 / 9" }) {
  const photo = SUMMIT_PHOTOS[photoKey] || {};
  const src = photo.url || "";
  const cap = caption || photo.caption || "";
  const lab = label || photo.label || photoKey;

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
              <Camera className="h-5 w-5" style={{ color: C.textMuted }} strokeWidth={1.8} />
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] font-semibold" style={{ color: C.textMuted }}>Photo coming</span>
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
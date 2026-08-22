import { Camera } from "lucide-react";
import { C } from "@/lib/feeUI";

export default function SitePhotos({ photos, onAddPhoto, onPhotoClick }) {
  return (
    <div>
      <h3 className="font-heading text-[13px] font-semibold mb-3" style={{ color: C.text }}>Site photos</h3>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={onAddPhoto}
          className="aspect-square rounded-[12px] flex flex-col items-center justify-center gap-1.5 transition-colors hover:bg-white/[0.02]"
          style={{ border: `1.5px dashed ${C.accent}` }}
        >
          <Camera className="h-5 w-5" style={{ color: C.accent }} />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] whitespace-nowrap" style={{ color: C.accent }}>Capture</span>
        </button>
        {photos.map((url, i) => (
          <button
            key={i}
            onClick={() => onPhotoClick(url)}
            className="aspect-square rounded-[12px] overflow-hidden"
            style={{ border: `1px solid ${C.border}` }}
          >
            <img src={url} alt={`Site photo ${i + 1}`} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
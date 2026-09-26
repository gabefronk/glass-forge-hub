import { useState } from "react";
import FeedImage from "./FeedImage";

const MAX_THUMBS = 8;

// Jobsite photos for one visit, report or note: a grid that fills the row
// (4 across on desktop, 3 on tablets, 2 on phones), 4:3 tiles, the rest
// behind "+N". Tap any to open it full size.
export default function PhotoStrip({ urls, onPhotoClick, className = "mt-3" }) {
  const [all, setAll] = useState(false);
  if (!urls || !urls.length) return null;
  const shown = all ? urls : urls.slice(0, MAX_THUMBS);
  const extra = urls.length - shown.length;
  return (
    <div className={`${className} grid grid-cols-4 gap-2 max-[900px]:grid-cols-3 max-[599px]:grid-cols-2`}>
      {shown.map((url, i) => {
        const last = !all && extra > 0 && i === shown.length - 1;
        return (
          <button key={i} type="button" onClick={() => (last ? setAll(true) : onPhotoClick(url))} className="group relative aspect-[4/3] w-full overflow-hidden rounded-[10px]" style={{ backgroundColor: "#eee9e0", border: "1px solid #e2dcd1", boxShadow: "0 1px 2px rgba(10,29,31,.08)" }} aria-label={last ? `Show ${extra + 1} more photos` : `Open photo ${i + 1}`}>
            <FeedImage src={url} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" loading="lazy" />
            {last ? <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[17px] font-bold text-white">+{extra + 1}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

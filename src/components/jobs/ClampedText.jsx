import { useLayoutEffect, useRef, useState } from "react";
import { cleanFeedText } from "@/lib/jobsSanitize";
import { C } from "@/lib/feeUI";
import { fileLabel, isPdfUrl, splitLinks } from "@/lib/fileLinks";

// Cleans long operational text (scope notes, report messages, note bodies) and
// clamps it to ~maxLines with a subtle Show more / Show less toggle. The full
// cleaned text stays accessible through the toggle.
export default function ClampedText({ text, maxLines = 5, className, style }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef(null);
  const cleaned = cleanFeedText(text);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (expanded) { setClamped(false); return; }
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [cleaned, expanded, maxLines]);

  const clampStyle = expanded ? {} : {
    display: "-webkit-box",
    WebkitLineClamp: maxLines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };

  if (!cleaned) return null;

  return (
    <div>
      <div ref={ref} className={className} style={{ ...clampStyle, ...style }}>
        {splitLinks(cleaned).map((part, i) => part.type === "link" ? (
          <a key={i} href={part.value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="break-all underline" style={{ color: C.accentText }}>
            {isPdfUrl(part.value) ? `${fileLabel(part.value)} (PDF)` : part.value}
          </a>
        ) : part.value)}
      </div>
      {clamped || expanded ? (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.13em]" style={{ color: C.accentText }}>
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
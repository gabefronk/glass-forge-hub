import { ExternalLink, FolderOpen } from "lucide-react";
import { C } from "@/lib/feeUI";
import { SUMMIT_DOCS } from "./summitData";

// Link cards to the Summit certification library in Drive.
export default function SummitDocs() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[14px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: C.cardShadow }}>
        <h3 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>Summit cert library</h3>
        <p className="text-[13px] mt-1" style={{ color: C.textSecondary }}>Field sheets, service guides, and factory manuals in Drive.</p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SUMMIT_DOCS.map((d) => {
            const isFolder = d.url.includes("/folders/");
            return (
              <a
                key={d.url}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-[12px] p-4 transition-colors"
                style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.rowHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.cardAlt)}
              >
                <div
                  className="flex items-center justify-center rounded-[10px] shrink-0"
                  style={{ width: "40px", height: "40px", backgroundColor: C.accent18, color: C.accentText }}
                >
                  {isFolder ? <FolderOpen className="h-5 w-5" /> : <ExternalLink className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold leading-tight" style={{ color: C.text }}>{d.label}</div>
                  {d.note && <div className="text-[12px] mt-0.5 leading-snug" style={{ color: C.textMuted }}>{d.note}</div>}
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
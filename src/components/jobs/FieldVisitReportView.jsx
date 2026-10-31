// The full originating field-visit report, opened from a Today follow-up item's link
// (/jobs/<id>?report=<FieldVisitReports id>). Read-only: this is where the person who was
// told about a visit reads what the worker actually filed, with every photo and video from
// the visit in one place.
//
// Money is shown only when the signed-in account may read it — charge_labor_amt and
// internal_cost_amount carry field-level RLS, so a crew account simply sees no amounts.
import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { sanitizeText } from "@/lib/jobsSanitize";
import { isVideoUrl } from "@/lib/fileLinks";
import {
  eventTypeLabel,
  reportSummaryLines,
  TRIGGER_LABELS,
  COST_STATE_LABELS,
} from "../../../base44/shared/fieldVisitReport.js";

const PAGE = "#F6F2EA", CARD = "#FFFFFF", LINE = "#D6CCBA", EDGE = "#B3A792";
const INK = "#101617", MUT = "#34403F";

const money = (n) => (typeof n === "number" && Number.isFinite(n) ? `$${n.toFixed(2)}` : null);

export default function FieldVisitReportView({ reportId, onClose }) {
  const [row, setRow] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    base44.entities.FieldVisitReports.get(reportId)
      .then((r) => { if (!cancelled) { setRow(r); setState("ready"); } })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [reportId]);

  const lines = row ? reportSummaryLines(row) : [];
  const media = Array.isArray(row?.media_urls) ? row.media_urls : [];
  const charge = money(row?.charge_labor_amt);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ backgroundColor: "rgba(15,38,40,.55)" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Field visit report"
        className="flex w-full max-h-[94dvh] flex-col overflow-hidden rounded-t-[18px] sm:max-w-[560px] sm:rounded-[16px] card-shadow-elevated"
        style={{ backgroundColor: PAGE }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-4 pb-3 pt-3 sm:px-5" style={{ borderBottom: `1px solid ${LINE}`, backgroundColor: CARD }}>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-[18px] font-bold" style={{ color: INK }}>
              {row ? eventTypeLabel(row.event_type) : "Field visit report"}
            </h3>
            <p className="text-[13px] break-words" style={{ color: MUT }}>
              {row ? [sanitizeText(row.job_name || ""), row.event_date].filter(Boolean).join(" · ") : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ border: `1px solid ${EDGE}`, color: INK, backgroundColor: CARD }}><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {state === "loading" ? <p className="flex items-center gap-2 text-[14px]" style={{ color: MUT }}><Loader2 className="h-4 w-4 animate-spin" />Loading the report…</p> : null}
          {state === "error" ? <p role="alert" className="text-[14px]" style={{ color: "#A43432" }}>This report could not be opened. It may have been removed.</p> : null}

          {state === "ready" && row ? (
            <>
              {(row.follow_up_triggers || []).length ? (
                <div className="rounded-[12px] p-3 text-[13.5px]" style={{ backgroundColor: "#FCF3E6", border: "1px solid #E6D4B4", color: INK }}>
                  Needs attention: {(row.follow_up_triggers || []).map((t) => TRIGGER_LABELS[t] || t).join(", ")}
                  {row.needs_rescheduling ? <div className="mt-1" style={{ color: MUT }}>Needs rescheduling{row.rescheduling_reason ? ` — ${sanitizeText(row.rescheduling_reason)}` : ""}. No replacement date has been set.</div> : null}
                </div>
              ) : null}

              <section className="rounded-[12px] p-3" style={{ backgroundColor: CARD, border: `1px solid ${EDGE}` }}>
                <ul className="space-y-1.5">
                  {lines.map((l, i) => <li key={i} className="text-[14px] leading-snug" style={{ color: INK }}>{sanitizeText(l)}</li>)}
                </ul>
              </section>

              <section className="rounded-[12px] p-3 text-[13.5px]" style={{ backgroundColor: CARD, border: `1px solid ${EDGE}`, color: MUT }}>
                {row.invoice_staging_state === "not_billable" ? <div>Not chargeable: this visit type is never billed to the customer.</div> : null}
                {row.invoice_staging_state === "staged" ? <div>Staged for invoicing{charge ? ` · ${charge}` : ""}.</div> : null}
                {row.invoice_staging_state === "none" ? <div>No charge for this visit.</div> : null}
                {row.internal_cost_state ? (
                  <div className="mt-1">
                    {COST_STATE_LABELS[row.internal_cost_state] || row.internal_cost_state}
                    {money(row.internal_cost_amount) ? ` · ${money(row.internal_cost_amount)}` : ""}
                    {row.internal_cost_state !== "priced" && row.internal_cost_reason === "no_internal_labor_cost_rate"
                      ? " — no verified internal labour rate is recorded yet, so no cost is claimed."
                      : ""}
                  </div>
                ) : null}
                {row.author ? <div className="mt-1">Filed by {sanitizeText(row.author)}</div> : null}
              </section>

              <section>
                <h4 className="mb-1.5 text-[12px] font-semibold uppercase" style={{ color: MUT, letterSpacing: ".06em" }}>
                  Photos &amp; videos{media.length ? ` · ${media.length}` : ""}
                </h4>
                {media.length ? (
                  <div className="grid grid-cols-3 gap-2">
                    {media.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="block aspect-[4/3] overflow-hidden rounded-[10px]" style={{ border: `1px solid ${LINE}` }}>
                        {isVideoUrl(u)
                          ? <video src={u} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                          : <img src={u} alt="" className="h-full w-full object-cover" />}
                      </a>
                    ))}
                  </div>
                ) : <p className="text-[13.5px]" style={{ color: MUT }}>No photos or videos were attached to this visit.</p>}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

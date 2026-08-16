import { Button } from "@/components/ui/button";
import { C, CARD_SHADOW, formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

function DetailRow({ label, children }) {
  return (
    <div>
      <div className="uppercase tracking-wide whitespace-nowrap" style={{ fontSize: "10px", fontWeight: 600, color: C.text, opacity: 0.62 }}>{label}</div>
      <div style={{ fontSize: "13px", color: C.text }}>{children}</div>
    </div>
  );
}

export default function JobRightRail({ job, totals, rows, lastSynced, onMarkBilled }) {
  const pos = job.po_numbers || [];
  const oes = job.oe_numbers || [];
  const hasBillableRows = rows.some(r => Number(r.labor_amt) > 0);
  const allBilled = hasBillableRows && rows.every(r => r.billed_to_bfs || Number(r.labor_amt) === 0);

  return (
    <div className="space-y-4">
      {/* Job details */}
      <div className="rounded-lg p-4" style={{ border: `1px solid ${C.border}`, boxShadow: CARD_SHADOW, backgroundColor: C.card }}>
        <h3 className="mb-3" style={{ fontSize: "13px", fontWeight: 700, color: C.accentDark }}>Job details</h3>
        <div className="space-y-2.5">
          {job.builder && <DetailRow label="Builder">{job.builder}</DetailRow>}
          {job.address && <DetailRow label="Address">{job.address}</DetailRow>}
          {pos.length > 0 && (
            <div>
              <div className="uppercase tracking-wide mb-1 whitespace-nowrap" style={{ fontSize: "10px", fontWeight: 600, color: C.text, opacity: 0.62 }}>PO numbers</div>
              <div className="flex flex-wrap gap-1.5">
                {pos.map((po, i) => (
                  <span key={i} className="font-mono whitespace-nowrap px-2 py-0.5 rounded" style={{ fontSize: "11px", backgroundColor: C.mutedBg, color: C.text }}>{po}</span>
                ))}
              </div>
            </div>
          )}
          {oes.length > 0 && (
            <div>
              <div className="uppercase tracking-wide mb-1 whitespace-nowrap" style={{ fontSize: "10px", fontWeight: 600, color: C.text, opacity: 0.62 }}>OE numbers</div>
              <div className="flex flex-wrap gap-1.5">
                {oes.map((oe, i) => (
                  <span key={i} className="font-mono whitespace-nowrap px-2 py-0.5 rounded" style={{ fontSize: "11px", backgroundColor: C.mutedBg, color: C.text }}>{oe}</span>
                ))}
              </div>
            </div>
          )}
          <DetailRow label="Last synced">{lastSynced ? formatShort(lastSynced) : "—"}</DetailRow>
        </div>
      </div>

      {/* Billing */}
      <div className="rounded-lg p-4" style={{ border: `1px solid ${C.border}`, boxShadow: CARD_SHADOW, background: "linear-gradient(to bottom, #f6f8f6, #f1f4f1)" }}>
        <h3 className="mb-3" style={{ fontSize: "13px", fontWeight: 700, color: C.accentDark }}>Billing</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="whitespace-nowrap" style={{ fontSize: "13px", color: C.text, opacity: 0.68 }}>Labor</span>
            <span className="tabular-nums" style={{ fontSize: "15px", fontWeight: 600, color: C.accentDark }}>{totals.labor ? `$${formatMoney(totals.labor)}` : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="whitespace-nowrap" style={{ fontSize: "13px", color: C.text, opacity: 0.68 }}>Fee at 10%</span>
            <span className="tabular-nums" style={{ fontSize: "17px", fontWeight: 700, color: C.accent }}>{totals.fee ? `$${formatMoney(totals.fee)}` : "—"}</span>
          </div>
          <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.border}` }}>
            <span className="whitespace-nowrap" style={{ fontSize: "13px", color: C.text, opacity: 0.68 }}>Status</span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: allBilled ? C.tagBillable.bg : C.tagReview.bg, color: allBilled ? C.tagBillable.text : C.tagReview.text }}>{allBilled ? "Billed" : "Not billed"}</span>
          </div>
          <Button className="w-full" disabled={allBilled || !hasBillableRows} onClick={onMarkBilled}>Mark billed to BFS</Button>
        </div>
      </div>
    </div>
  );
}
import { C, formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

function DetailRow({ label, children }) {
  return (
    <div>
      <div className="mono-label-sm mb-1">{label}</div>
      <div className="text-[13px] break-words" style={{ color: C.text }}>{children}</div>
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
      <div className="rounded-[16px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
        <h3 className="font-heading text-[13px] font-semibold mb-3" style={{ color: C.text }}>Job details</h3>
        <div className="space-y-3">
          {job.builder && <DetailRow label="Builder">{job.builder}</DetailRow>}
          {job.address && <DetailRow label="Address">{job.address}</DetailRow>}
          {pos.length > 0 && (
            <div>
              <div className="mono-label-sm mb-1.5">PO numbers</div>
              <div className="flex flex-wrap gap-1.5">
                {pos.map((po, i) => (
                  <span key={i} className="max-w-full font-mono break-all px-2 py-0.5 rounded text-[11px]" style={{ backgroundColor: C.mutedBg, color: C.textSecondary }}>{po}</span>
                ))}
              </div>
            </div>
          )}
          {oes.length > 0 && (
            <div>
              <div className="mono-label-sm mb-1.5">OE numbers</div>
              <div className="flex flex-wrap gap-1.5">
                {oes.map((oe, i) => (
                  <span key={i} className="max-w-full font-mono break-all px-2 py-0.5 rounded text-[11px]" style={{ backgroundColor: C.mutedBg, color: C.textSecondary }}>{oe}</span>
                ))}
              </div>
            </div>
          )}
          <DetailRow label="Last synced">{lastSynced ? formatShort(lastSynced) : "—"}</DetailRow>
        </div>
      </div>

      {/* Billing */}
      <div className="rounded-[16px] p-5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
        <h3 className="font-heading text-[13px] font-semibold mb-3" style={{ color: C.text }}>Billing</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] whitespace-nowrap" style={{ color: C.textSecondary }}>Labor</span>
            <span className="font-mono-num text-[15px] font-medium" style={{ color: C.text }}>{totals.labor ? `$${formatMoney(totals.labor)}` : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] whitespace-nowrap" style={{ color: C.textSecondary }}>Fee at 10%</span>
            <span className="font-mono-num-bold text-[18px]" style={{ color: C.accent, letterSpacing: "-0.02em" }}>{totals.fee ? `$${formatMoney(totals.fee)}` : "—"}</span>
          </div>
          <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.border}` }}>
            <span className="text-[13px] whitespace-nowrap" style={{ color: C.textSecondary }}>Status</span>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: allBilled ? C.tagBillable.bg : C.tagReview.bg, color: allBilled ? C.tagBillable.text : C.tagReview.text }}>{allBilled ? "Billed" : "Not billed"}</span>
          </div>
          <button
            onClick={onMarkBilled}
            disabled={allBilled || !hasBillableRows}
            className="w-full py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors"
            style={
              allBilled || !hasBillableRows
                ? { backgroundColor: "rgba(255,255,255,.08)", color: C.textMuted }
                : { backgroundColor: C.accent, color: C.accentDark }
            }
          >
            Mark billed to BFS
          </button>
        </div>
      </div>
    </div>
  );
}

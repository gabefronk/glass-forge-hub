import { C } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

export default function LineItems({ rows }) {
  return (
    <div className="rounded-[16px] overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="px-5 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <h3 className="font-heading text-[13px] font-semibold" style={{ color: C.text }}>Line items</h3>
      </div>
      <div>
        {rows.length === 0 && (
          <div className="px-5 py-8 text-center text-[13px]" style={{ color: C.textMuted }}>No line items yet.</div>
        )}
        {rows.map((row, i) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-3 px-5"
            style={{ minHeight: "48px", borderTop: i > 0 ? `1px solid ${C.rowBorder}` : "none" }}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate" style={{ color: C.text }}>{row.line_description || row.job_name_norm}</div>
              <div className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>{row.job_date}</div>
            </div>
            <div className="text-right font-mono-num-bold text-[13px] whitespace-nowrap" style={{ color: C.accent }}>
              ${formatMoney(row.fee_amt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
import { Pencil, Trash2 } from "lucide-react";
import { C } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

function monthLabel(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function ProfitTable({ rows, gfDerivedByMonth, onEdit, onDelete }) {
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: `2px solid ${C.border}` }}>
            <th className="text-left py-2.5 px-3 font-medium uppercase tracking-wider text-xs" style={{ color: C.mutedText }}>Month</th>
            <th className="text-right py-2.5 px-3 font-medium uppercase tracking-wider text-xs" style={{ color: C.mutedText }}>YA Windows</th>
            <th className="text-right py-2.5 px-3 font-medium uppercase tracking-wider text-xs" style={{ color: C.mutedText }}>Glass Forge</th>
            <th className="text-right py-2.5 px-3 font-medium uppercase tracking-wider text-xs" style={{ color: C.mutedText }}>GF (from Fee Lines)</th>
            <th className="text-left py-2.5 px-3 font-medium uppercase tracking-wider text-xs hidden md:table-cell" style={{ color: C.mutedText }}>Notes</th>
            <th className="py-2.5 px-3 w-20" />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center py-8 text-sm" style={{ color: C.mutedText }}>
                No monthly entries yet. Add your first month above.
              </td>
            </tr>
          )}
          {sorted.map((r) => {
            const derived = gfDerivedByMonth[r.month] || 0;
            const diff = Math.abs((Number(r.glass_forge_profit) || 0) - derived);
            const mismatch = derived > 0 && diff > 1;
            return (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.rowBorder}` }}>
                <td className="py-2.5 px-3 font-medium" style={{ color: C.text }}>{monthLabel(r.month)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: C.accent }}>${formatMoney(r.ya_windows_profit)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: "#8a5a12" }}>${formatMoney(r.glass_forge_profit)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-xs" style={{ color: mismatch ? C.amber : C.mutedText }}>
                  {derived > 0 ? `$${formatMoney(derived)}` : "—"}
                  {mismatch && <span className="ml-1" title="Differs from entered value">⚠</span>}
                </td>
                <td className="py-2.5 px-3 text-xs hidden md:table-cell max-w-xs truncate" style={{ color: C.mutedText }}>{r.notes || ""}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => onEdit(r)} className="p-1.5 rounded hover:bg-black/5" style={{ color: C.mutedText }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => onDelete(r)} className="p-1.5 rounded hover:bg-red-50" style={{ color: C.mutedText }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
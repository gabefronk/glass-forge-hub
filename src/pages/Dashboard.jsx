import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";
import ProfitSummaryCards from "@/components/dashboard/ProfitSummaryCards";
import ProfitChart from "@/components/dashboard/ProfitChart";
import ProfitForm from "@/components/dashboard/ProfitForm";
import ProfitTable from "@/components/dashboard/ProfitTable";
import { Plus } from "lucide-react";

export default function Dashboard() {
  const [profits, setProfits] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [mp, fl] = await Promise.all([
        base44.entities.MonthlyProfit.list("-month", 500),
        base44.entities.FeeLines.list("-job_date", 5000),
      ]);
      setProfits(Array.isArray(mp) ? mp : []);
      setFeeLines(Array.isArray(fl) ? fl : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Glass Forge profit derived from FeeLines: sum of fee_amt where invoiced_to_ya, by month
  const gfDerivedByMonth = useMemo(() => {
    const m = {};
    for (const f of feeLines) {
      if (f.invoiced_to_ya && f.invoice_month) {
        m[f.invoice_month] = (m[f.invoice_month] || 0) + (Number(f.fee_amt) || 0);
      }
    }
    return m;
  }, [feeLines]);

  const handleSave = async (data) => {
    if (editing) {
      await base44.entities.MonthlyProfit.update(editing.id, data);
      setProfits((prev) => prev.map((p) => (p.id === editing.id ? { ...p, ...data } : p)));
    } else {
      const row = await base44.entities.MonthlyProfit.create(data);
      setProfits((prev) => [...prev, row]);
    }
    setShowForm(false);
    setEditing(null);
  };

  const handleEdit = (row) => {
    setEditing(row);
    setShowForm(true);
  };

  const handleDelete = async (row) => {
    if (!confirm(`Delete ${row.month}?`)) return;
    await base44.entities.MonthlyProfit.delete(row.id);
    setProfits((prev) => prev.filter((p) => p.id !== row.id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="px-4 sm:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>Profit Dashboard</h1>
          <button
            onClick={() => { setEditing(null); setShowForm((v) => !v); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors"
            style={{ backgroundColor: showForm ? C.mutedBg : C.accent, color: showForm ? C.text : "white" }}
          >
            <Plus className="h-4 w-4" />
            {showForm ? "Close" : "Add Month"}
          </button>
        </div>

        <ProfitSummaryCards profits={profits} />

        <div className="mt-6 rounded-lg p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: C.mutedText }}>Monthly Profit Comparison</h2>
          <ProfitChart data={profits} />
        </div>

        {showForm && (
          <div className="mt-6">
            <ProfitForm
              initial={editing}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          </div>
        )}

        <div className="mt-6 rounded-lg overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.mutedText }}>Monthly Entries</h2>
          </div>
          <ProfitTable
            rows={profits}
            gfDerivedByMonth={gfDerivedByMonth}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>

        <p className="mt-4 text-xs" style={{ color: C.mutedText }}>
          "GF (from Fee Lines)" shows the sum of invoiced fees from the Invoicing tab for that month — use it to cross-check your entered Glass Forge profit.
        </p>
      </div>
    </div>
  );
}
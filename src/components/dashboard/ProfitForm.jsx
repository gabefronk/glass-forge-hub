import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { C } from "@/lib/feeUI";

export default function ProfitForm({ initial, onSave, onCancel }) {
  const [month, setMonth] = useState(initial?.month || "");
  const [yaProfit, setYaProfit] = useState(initial?.ya_windows_profit ?? "");
  const [gfProfit, setGfProfit] = useState(initial?.glass_forge_profit ?? "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!month) return;
    setSaving(true);
    try {
      await onSave({
        month,
        ya_windows_profit: Number(yaProfit) || 0,
        glass_forge_profit: Number(gfProfit) || 0,
        notes: notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: C.mutedText }}>Month</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={saving} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: C.mutedText }}>YA Windows Profit ($)</Label>
          <Input type="number" step="0.01" placeholder="0.00" value={yaProfit} onChange={(e) => setYaProfit(e.target.value)} disabled={saving} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: C.mutedText }}>Glass Forge Profit ($)</Label>
          <Input type="number" step="0.01" placeholder="0.00" value={gfProfit} onChange={(e) => setGfProfit(e.target.value)} disabled={saving} />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider" style={{ color: C.mutedText }}>Notes</Label>
        <Textarea rows={2} placeholder="Optional notes about this month's figures" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || !month} style={{ backgroundColor: C.accent, color: "white" }}>
          {saving ? "Saving..." : initial ? "Update" : "Add Month"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}
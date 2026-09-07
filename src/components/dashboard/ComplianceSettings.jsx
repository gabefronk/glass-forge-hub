import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { Settings } from "lucide-react";

export default function ComplianceSettings({ value, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const existing = await base44.entities.AppSettings.list("-created_date", 10);
      if (existing && existing.length > 0) {
        await base44.entities.AppSettings.update(existing[0].id, { compliance_start_date: draft });
      } else {
        await base44.entities.AppSettings.create({ compliance_start_date: draft });
      }
      setEditing(false);
      if (onChanged) await onChanged();
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-[14px] px-5 py-4 mb-5 flex items-start gap-3 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <Settings className="h-4 w-4 shrink-0 mt-1" style={{ color: C.textMuted }} />
      <div className="flex-1 min-w-0">
        <div className="mono-label-sm mb-1">Compliance start date</div>
        {editing ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Compliance start date"
              className="min-w-0 max-w-full rounded-full px-3 py-1.5 text-[12px] font-mono"
              style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }}
            />
            <button onClick={handleSave} disabled={saving || !draft} className="px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark, opacity: saving || !draft ? 0.5 : 1 }}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={() => { setEditing(false); setDraft(value || ""); }} className="px-3 py-1.5 rounded-full text-[12px] whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono-num text-[14px]" style={{ color: C.text }}>
              {value || "Not set"}
            </span>
            <button onClick={() => { setEditing(true); setDraft(value || ""); }} className="text-[10px] font-semibold tracking-[0.01em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              Edit
            </button>
            <span className="text-[11px]" style={{ color: C.textMuted }}>
              Events before this date are excluded from compliance tracking
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

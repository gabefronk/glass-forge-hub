import { useMemo, useState } from "react";
import { Link2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { computeJobBudget, SALES_TAX_RATE } from "../../../base44/shared/jobBudgetMath.js";
import { budgetVersion } from "../../../base44/shared/procurementCore.js";

// The review step under a Job Budgets row: type the budget numbers (material cost,
// labor cost, labor sell, total sell) and, for rows the drop could not place, pick or
// create the Hub job. Both call jobBudgetIngest, which refiles the Drive folder under the
// job and refreshes the invoicing cost inputs. (No budget-sheet copy is written any more.)

const money = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)))
  ? "-" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n))) ? "-" : (Number(n) * 100).toFixed(1) + "%";
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };

const FIELDS = [
  ["material_true_cost", "Material cost (what you pay)", "2748.78"],
  ["labor_cost_sub_pay", "Labor cost (sub pay)", "900"],
  // Labor sell price hidden for now (Gabriel 10/22: he fills sub pay only).
  ["actual_total_sell", "Total sell to customer (incl. tax)", "7022.31"],
];
const EXTRA = [
  ["additional_install_material", "Additional install material"],
  ["additional_equipment", "Additional equipment"],
];
const FIELD_LABEL = Object.fromEntries([...FIELDS, ...EXTRA].map(([k, l]) => [k, l]));

const inputCls = "text-[13px] px-3 py-2 rounded-[8px] w-full";
const inputStyle = { border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text };
const btnPrimary = { backgroundColor: C.accent, color: "#fff" };
const btnGhost = { border: `1px solid ${C.border}`, color: C.text, backgroundColor: C.card };

export const smallBtn = "inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-[8px] disabled:opacity-50 whitespace-nowrap";

export function BudgetRowButtons({ budget, mode, onMode, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (!window.confirm(`Delete "${budget.title}"? This removes the budget row and its numbers from the Hub. The quote PDF and sheet in Drive are not deleted.`)) return;
    setBusy(true); setError("");
    try {
      const res = await base44.functions.invoke("jobBudgetIngest", { action: "delete", budget_id: budget.id });
      const data = res?.data || res;
      if (data?.error) { setError(data.error); setBusy(false); return; }
      onDelete?.(budget);
    } catch (e) { setError(e?.response?.data?.error || e?.message || "Could not delete."); setBusy(false); }
  };
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => onMode(mode === "numbers" ? "" : "numbers")} className={smallBtn} style={mode === "numbers" ? btnPrimary : btnGhost} title="Type the workbook numbers">
        <Pencil className="h-3.5 w-3.5" />Numbers
      </button>
      {!budget.job_id ? (
        <button type="button" onClick={() => onMode(mode === "link" ? "" : "link")} className={smallBtn} style={mode === "link" ? btnPrimary : btnGhost} title="Choose the Hub job this budget belongs to">
          <Link2 className="h-3.5 w-3.5" />Link job
        </button>
      ) : null}
      <button type="button" disabled={busy} onClick={remove} className={smallBtn} style={{ border: `1px solid ${C.border}`, color: "#A43432", backgroundColor: C.card }} title="Delete this budget row">
        <Trash2 className="h-3.5 w-3.5" />{busy ? "Deleting…" : "Delete"}
      </button>
      {error ? <span role="alert" className="text-[11px] font-medium" style={{ color: "#A43432" }}>{error}</span> : null}
    </div>
  );
}

function fromBudget(b) {
  const i = b?.inputs || {};
  const out = {};
  for (const k of [...FIELDS, ...EXTRA].map(([k]) => k)) out[k] = i[k] === null || i[k] === undefined ? "" : String(i[k]);
  return out;
}

export function NumbersEditor({ budget, onDone, onCancel, onRefilled, hideRefill = false }) {
  const [form, setForm] = useState(() => fromBudget(budget));
  const [version, setVersion] = useState(() => budgetVersion(budget));
  const [reviewed, setReviewed] = useState(false);
  const [zeroConfirmed, setZeroConfirmed] = useState(false);
  const [fill, setFill] = useState(() => budget.autofill || null);
  const [touched, setTouched] = useState({});
  const [more, setMore] = useState(() => num(form.additional_install_material) > 0 || num(form.additional_equipment) > 0);
  const [busy, setBusy] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const [error, setError] = useState("");
  const preview = useMemo(() => computeJobBudget(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, num(v)]))), [form]);
  const set = (k) => (e) => { setReviewed(false); if (k === 'material_true_cost') setZeroConfirmed(false); setTouched((t) => ({ ...t, [k]: true })); setForm((f) => ({ ...f, [k]: e.target.value })); };
  const sources = fill?.sources || {};

  // Read the quote PDF again and refill every box it can (saves straight to the row).
  const refill = async () => {
    if (!budget.source_pdf_url) return;
    if (!window.confirm("Re-read the original PDF and replace the working budget inputs? Previous saved inputs remain in history. Issued POs and approved customer pricing will not change.")) return;
    setRefilling(true); setError("");
    try {
      const res = await base44.functions.invoke("jobBudgetIngest", { action: "refill", budget_id: budget.id, expected_version: version, request_key: crypto.randomUUID(), review_confirmed: true });
      const data = res?.data || res;
      if (data?.error) { setError(data.error); return; }
      setForm(fromBudget({ inputs: data.inputs }));
      if (data.budget) setVersion(budgetVersion(data.budget));
      setReviewed(false); setZeroConfirmed(false);
      setFill({ sources: data.sources || {}, notes: data.notes || [] });
      setTouched({});
      onRefilled?.(data);
    } catch (e) { setError(e?.response?.data?.error || e?.message || "Could not read the quote."); }
    finally { setRefilling(false); }
  };

  const save = async () => {
    if (!reviewed || (num(form.material_true_cost) === 0 && !zeroConfirmed)) { setError('Review the numbers and confirm any zero material cost.'); return; }
    setBusy(true); setError("");
    try {
      const res = await base44.functions.invoke("jobBudgetIngest", { action: "set_inputs", budget_id: budget.id, inputs: form, expected_version: version, request_key: crypto.randomUUID(), review_confirmed: reviewed, zero_cost_confirmed: zeroConfirmed });
      const data = res?.data || res;
      if (data?.error) { setError(data.fields?.length ? `Check: ${data.fields.map((f) => FIELD_LABEL[f] || f).join(", ")}` : data.error); return; }
      onDone(data);
    } catch (e) {
      const d = e?.response?.data;
      setError(d?.fields?.length ? `Check: ${d.fields.map((f) => FIELD_LABEL[f] || f).join(", ")}` : d?.error || e?.message || "Could not save.");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3 rounded-[12px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="m-0 text-[12.5px] flex-1 min-w-[240px]" style={{ color: C.textMuted }}>The yellow cells of the Window Budget Sheet{fill ? ", filled from the quote and your install price sheet — fix anything that's off" : ""}. Saving keeps the previous inputs in history and updates the working budget and Drive sheets. Invoice amounts, actual costs and issued POs are not changed.</p>
        {budget.source_pdf_url && !hideRefill ? (
          <button type="button" disabled={busy || refilling} onClick={refill} className={smallBtn} style={btnGhost} title="Read the quote PDF again and fill every box it can">
            <RefreshCw className={`h-3.5 w-3.5${refilling ? " animate-spin" : ""}`} />{refilling ? "Reading quote…" : fill ? "Re-read quote" : "Fill from quote"}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-2 max-[899px]:grid-cols-2 max-[599px]:grid-cols-1">
        {FIELDS.map(([k, label, ph]) => (
          <label key={k} className="flex flex-col gap-1 text-[12px] font-medium" style={{ color: C.textMuted }}>
            {label}
            <input inputMode="decimal" value={form[k]} onChange={set(k)} placeholder={ph} className={inputCls}
              style={sources[k] && !touched[k] ? { ...inputStyle, backgroundColor: "#FFF8DB", borderColor: "#E9D78A" } : inputStyle} />
            {sources[k] ? (
              <span className="text-[11px] font-normal leading-snug" style={{ color: touched[k] ? C.textFaint : C.textSecondary }}>
                {touched[k] ? "Edited — was " : "Auto · "}{touched[k] ? sources[k].toLowerCase() : sources[k]}
              </span>
            ) : fill ? <span className="text-[11px] font-normal" style={{ color: C.amber }}>Not on the quote — type it</span> : null}
          </label>
        ))}
      </div>
      {fill?.notes?.length ? (
        <ul className="m-0 pl-4 text-[12px] flex flex-col gap-0.5" style={{ color: C.amber }}>
          {fill.notes.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      ) : null}
      {more ? (
        <div className="grid grid-cols-4 gap-2 max-[899px]:grid-cols-2 max-[599px]:grid-cols-1">
          {EXTRA.map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-[12px] font-medium" style={{ color: C.textMuted }}>
              {label}
              <input inputMode="decimal" value={form[k]} onChange={set(k)} placeholder="0" className={inputCls} style={inputStyle} />
            </label>
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="self-start text-[12px] font-semibold" style={{ color: C.accentText }}>+ Additional install material / equipment</button>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]" style={{ color: C.textSecondary }}>
        <span>Cost basis <b style={{ color: C.text }}>{money(preview.total_cost_overhead)}</b></span>
        <span>Use tax (auto {(SALES_TAX_RATE * 100).toFixed(2)}%) <b style={{ color: C.text }}>{money(preview.use_tax)}</b></span>
        <span>Margin <b style={{ color: (preview.actual_margin_pct ?? 0) >= 0.3 ? C.accentText : C.amber }}>{pct(num(form.material_true_cost) === 0 && !zeroConfirmed ? null : preview.actual_margin_pct)}</b></span>
      </div>
      {error ? <p role="alert" className="m-0 text-[12.5px] font-medium" style={{ color: C.amber }}>{error}</p> : null}
      {num(form.material_true_cost) === 0 && <label className="flex items-start gap-2 text-[13px]" style={{ color: C.amber }}><input type="checkbox" checked={zeroConfirmed} onChange={e => { setZeroConfirmed(e.target.checked); setReviewed(false); }} />Zero material cost is intentional, not a missing supplier price.</label>}
      <label className="flex items-start gap-2 text-[13px]" style={{ color: C.text }}><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the material, labor, extras and customer sell for this scope.</label>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || refilling || !reviewed || (num(form.material_true_cost) === 0 && !zeroConfirmed)} onClick={save} className={smallBtn} style={btnPrimary}>{busy ? "Saving…" : "Save reviewed numbers"}</button>
        <button type="button" disabled={busy} onClick={onCancel} className={smallBtn} style={btnGhost}>Cancel</button>
      </div>
    </div>
  );
}


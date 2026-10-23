import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { PAYMENT_STAGES, paymentStage, paymentPatch } from "@/lib/jobPayment";

const CHIP_TONES = {
  half_down:        { bg: "#FCEFE0", color: "#96490F", border: "#F1D3B2" },
  installed:        { bg: "#EAF2FF", color: "#3977CB", border: "#C7D8EF" },
  sent_for_payment: { bg: "#FFF3DF", color: "#8a6420", border: "#F0DBA8" },
  waiting_on_payment:{ bg: "#FFF3DF", color: "#34403F", border: "#F0DBA8" },
  partial:          { bg: "#FFF3DF", color: "#8a6420", border: "#F0DBA8" },
  paid:             { bg: "#EAF5EE", color: "#166447", border: "#C7E4D2" },
};

// Read-only pill used on list rows and purchasing cards so Gabriel can scan
// which jobs are submitted for payment vs not. Renders nothing when unset.
export function PaymentStatusChip({ job }) {
  const stage = paymentStage(job?.payment_status);
  if (!stage) return null;
  const t = CHIP_TONES[stage.key];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap"
      style={{ backgroundColor: t.bg, color: t.color, border: `1px solid ${t.border}` }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />
      {stage.label}
    </span>
  );
}

// The status switcher beside the job name in the hero (owner-only; the page gates it).
// Just the current status as a colored dropdown - picking a stage saves immediately,
// "Clear status" untracks the job. Same Jobs.payment_status fields the jobs list and
// purchasing cards read, so everything stays in sync. Colors match the old card.
export default function PaymentStatusDropdown({ job, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = paymentStage(job?.payment_status);
  const t = active ? CHIP_TONES[active.key] : null;

  const change = async (e) => {
    const key = e.target.value;
    if (busy || key === (job?.payment_status || "")) return;
    setBusy(true); setError("");
    try {
      const patch = key ? paymentPatch(job, key) : { payment_status: null, payment_status_at: null };
      await base44.entities.Jobs.update(job.id, patch);
      await onChanged?.();
    } catch (err) {
      setError(err?.message || "Could not save the payment status.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="relative inline-flex">
        <select
          aria-label="Customer payment status"
          value={active?.key || ""}
          disabled={busy}
          onChange={change}
          className="h-[30px] max-w-[210px] appearance-none rounded-full pl-3 pr-8 text-[12.5px] font-bold outline-none transition-opacity disabled:opacity-60"
          style={active
            ? { backgroundColor: t.color, color: "#FFFFFF", border: `1px solid ${t.color}` }
            : { backgroundColor: "rgba(255,255,255,.09)", color: "#c9d0d1", border: "1px solid rgba(255,255,255,.18)" }}
        >
          <option value="">{active ? "Clear status" : "Payment status"}</option>
          {active && !PAYMENT_STAGES.some((s) => s.key === active.key)
            ? <option value={active.key}>{active.label}</option>
            : null}
          {PAYMENT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: active ? "#FFFFFF" : "#c9d0d1" }} />
      </span>
      {error ? <span role="alert" className="text-[12px] font-semibold" style={{ color: "#f1b9b3" }}>{error}</span> : null}
    </span>
  );
}

import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { PAYMENT_STAGES, paymentStage, paymentPatch } from "@/lib/jobPayment";

const CHIP_TONES = {
  installed:        { bg: "#EAF2FF", color: "#3977CB", border: "#C7D8EF" },
  sent_for_payment: { bg: "#FFF3DF", color: "#8a6420", border: "#F0DBA8" },
  waiting_on_payment:{ bg: "#FFF3DF", color: "#34403F", border: "#F0DBA8" },
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

// One-tap stage buttons on the job page. Owner-only (the page gates it).
export default function JobPaymentStatus({ job, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = paymentStage(job?.payment_status);

  const tap = async (key) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const patch = paymentPatch(job, key);
      await base44.entities.Jobs.update(job.id, patch);
      await onChanged?.();
    } catch (e) {
      setError(e?.message || "Could not save the payment status.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[14px] px-5 py-4 card-shadow" style={{ border: "1px solid #DDE0DA", backgroundColor: "#FFFFFF" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold tracking-[.12em] uppercase mr-1" style={{ color: "#53615B" }}>Customer payment</span>
        {PAYMENT_STAGES.map((s) => {
          const isActive = active?.key === s.key;
          const t = CHIP_TONES[s.key];
          return (
            <button
              key={s.key}
              type="button"
              disabled={busy}
              aria-pressed={isActive}
              onClick={() => tap(s.key)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold whitespace-nowrap transition-opacity disabled:opacity-60"
              style={isActive
                ? { backgroundColor: t.color, color: "#FFFFFF", border: `1px solid ${t.color}` }
                : { backgroundColor: t.bg, color: t.color, border: `1px solid ${t.border}` }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isActive ? "#FFFFFF" : t.color }} />
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[11.5px]" style={{ color: "#8A958F" }}>
        {active
          ? <>Set to <strong>{active.label}</strong>{job.payment_status_at ? ` on ${String(job.payment_status_at).slice(0, 10)}` : ""}. Tap it again to clear.</>
          : "Tap a stage when it happens. It shows on the jobs list and purchasing cards."}
      </div>
      {error ? <p role="alert" className="mt-1 text-[12px]" style={{ color: "#A43432" }}>{error}</p> : null}
    </div>
  );
}

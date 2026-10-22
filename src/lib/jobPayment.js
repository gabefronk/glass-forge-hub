// Customer-payment tracking on a job: one-tap stages Gabriel sets himself.
// Stored on the Jobs entity as payment_status (stage key) + payment_status_at
// (ISO timestamp of the last change). Both null means not tracked yet.
export const PAYMENT_STAGES = [
  { key: "installed", label: "Job installed" },
  { key: "sent_for_payment", label: "Sent for payment · QuickBooks" },
  { key: "waiting_on_payment", label: "Waiting on payment" },
  { key: "partial", label: "Partial payment" },
  { key: "paid", label: "Paid" },
];

export function paymentStage(key) {
  return PAYMENT_STAGES.find((s) => s.key === key) || null;
}

// One-tap semantics: tapping a different stage moves to it; tapping the
// active stage again clears tracking (undo a mis-tap). `now` injectable
// for tests.
export function paymentPatch(job, stageKey, now = new Date().toISOString()) {
  if (!paymentStage(stageKey)) throw new Error(`unknown payment stage: ${stageKey}`);
  if (job?.payment_status === stageKey) {
    return { payment_status: null, payment_status_at: null };
  }
  return { payment_status: stageKey, payment_status_at: now };
}

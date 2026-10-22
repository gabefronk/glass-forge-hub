// Customer-payment tracking on a job: one-tap stages Gabriel sets himself.
// Stored on the Jobs entity as payment_status (stage key) + payment_status_at
// (ISO timestamp of the last change). Both null means not tracked yet.
//
// PAYMENT_STAGES is the picker list, in the order shown (after "Not tracked").
// The `paid` key is kept (labelled "Full payment received") so jobs already
// marked paid keep their status.
export const PAYMENT_STAGES = [
  { key: "half_down", label: "Half down paid" },
  { key: "installed", label: "Job installed" },
  { key: "paid", label: "Full payment received" },
  { key: "waiting_on_payment", label: "Waiting on payment" },
];

// Stages retired from the picker. Jobs already on one still show it correctly;
// it just cannot be chosen again.
const LEGACY_STAGES = [
  { key: "sent_for_payment", label: "Sent for payment · QuickBooks" },
  { key: "partial", label: "Partial payment" },
];

// Colour ramp for the payment picker on the purchasing table: red means nothing
// has been billed yet, green means it is paid. `none` is the untracked start.
export const PAYMENT_TONES = {
  none:               { dot: "#A43432", text: "#8E2F2C", bg: "#FBEAE8", border: "#F0C9C5" },
  half_down:          { dot: "#C2601C", text: "#96490F", bg: "#FCEFE0", border: "#F1D3B2" },
  installed:          { dot: "#A8861A", text: "#7A6010", bg: "#FBF4DB", border: "#EDE0A8" },
  paid:               { dot: "#166447", text: "#166447", bg: "#EAF5EE", border: "#C7E4D2" },
  waiting_on_payment: { dot: "#5D8C3A", text: "#3F6B21", bg: "#EFF6E4", border: "#D3E5BB" },
  sent_for_payment:   { dot: "#A8861A", text: "#7A6010", bg: "#FBF4DB", border: "#EDE0A8" },
  partial:            { dot: "#3E7C46", text: "#2C5F33", bg: "#E9F4E2", border: "#CCE2BD" },
};

export function paymentStage(key) {
  return PAYMENT_STAGES.find((s) => s.key === key) || LEGACY_STAGES.find((s) => s.key === key) || null;
}

// One-tap semantics: tapping a different stage moves to it; tapping the
// active stage again clears tracking (undo a mis-tap). `now` injectable
// for tests.
export function paymentPatch(job, stageKey, now = new Date().toISOString()) {
  if (!PAYMENT_STAGES.some((s) => s.key === stageKey)) throw new Error(`unknown payment stage: ${stageKey}`);
  if (job?.payment_status === stageKey) {
    return { payment_status: null, payment_status_at: null };
  }
  return { payment_status: stageKey, payment_status_at: now };
}
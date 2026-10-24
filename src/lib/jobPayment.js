// Job stage on a job: one-tap stages Gabriel sets himself, from quote sent to
// paid. Stored on the Jobs entity as payment_status (stage key) +
// payment_status_at (ISO timestamp of the last change). Both null means not
// set yet. The field keeps its old name so every reader (Purchasing, the job
// page, Customers owe) stays on one field.
//
// PAYMENT_STAGES is the picker list, in the order shown (Gabriel, Oct 24).
export const PAYMENT_STAGES = [
  { key: "sent_to_customer", label: "Sent to customer" },
  { key: "ordered", label: "Ordered" },
  { key: "half_down", label: "Half down paid" },
  { key: "delivered", label: "Delivered" },
  { key: "installed", label: "Installed" },
  { key: "billed", label: "Billed" },
  { key: "waiting_on_check", label: "Waiting on check" },
  { key: "waiting_on_payment", label: "Waiting on payment" },
  { key: "paid", label: "Paid" },
];

// Stages retired from the picker. Jobs already on one still show it correctly;
// it just cannot be chosen again.
const LEGACY_STAGES = [
  { key: "sent_for_payment", label: "Sent for payment · QuickBooks" },
  { key: "partial", label: "Partial payment" },
];

// Stage colours (YA Windows tokens): grey before the order, slate while it is on
// order, sage once delivered, teal once installed or billed, amber while money is
// outstanding, solid teal when paid. `none` is a job with no stage yet.
const SLATE = { dot: "#34506A", text: "#34506A", bg: "#E7EDF2", border: "#C7D8EF" };
const TEAL = { dot: "#0B3F3B", text: "#082F2C", bg: "#E2EEEB", border: "#C7E4D2" };
const AMBER = { dot: "#C08B2E", text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" };
export const PAYMENT_TONES = {
  none:               { dot: "#B8B0A4", text: "#566063", bg: "#FFFFFF", border: "#E2DCD1" },
  sent_to_customer:   { dot: "#8C9EAF", text: "#34403F", bg: "#F3EFE7", border: "#E2DCD1" },
  ordered:            SLATE,
  half_down:          SLATE,
  delivered:          { dot: "#3B5A3A", text: "#3B5A3A", bg: "#E8EEE4", border: "#CDDBC6" },
  installed:          TEAL,
  billed:             TEAL,
  waiting_on_check:   AMBER,
  waiting_on_payment: AMBER,
  paid:               { dot: "#FFFFFF", text: "#FFFFFF", bg: "#0B3F3B", border: "#0B3F3B" },
  sent_for_payment:   AMBER,
  partial:            SLATE,
};

export function paymentStage(key) {
  return PAYMENT_STAGES.find((s) => s.key === key) || LEGACY_STAGES.find((s) => s.key === key) || null;
}

// One-tap semantics: tapping a different stage moves to it; tapping the
// active stage again clears it (undo a mis-tap). `now` injectable for tests.
export function paymentPatch(job, stageKey, now = new Date().toISOString()) {
  if (!PAYMENT_STAGES.some((s) => s.key === stageKey)) throw new Error(`unknown payment stage: ${stageKey}`);
  if (job?.payment_status === stageKey) {
    return { payment_status: null, payment_status_at: null };
  }
  return { payment_status: stageKey, payment_status_at: now };
}

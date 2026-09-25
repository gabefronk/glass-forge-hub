// Optional bridge to the JobSetupSheets contract introduced by PR #3.
//
// That contract describes whole-job costs/pricing and may cover more than one
// product or vendor. It has no vendor-specific PO fields, so none of its costs,
// pricing, sources, or scope lines are safe to translate into a PO draft.
// This adapter therefore establishes only that one owner-approved sheet belongs
// to the selected job. It never issues or persists a PO.

const presentText = (value) => typeof value === "string" && value.trim() !== "";

export function isOwnerApprovedSetupSheet(sheet) {
  return sheet?.status === "approved"
    && presentText(sheet.approved_by)
    && presentText(sheet.approved_at);
}

export function purchaseOrderDraftFromSetupSheet(sheet) {
  if (!isOwnerApprovedSetupSheet(sheet)) return null;
  // PR #3 has no vendor-specific vendor, quote reference, or amount fields.
  // In particular, costs and pricing are job totals and must not become PO data.
  return {};
}

export function selectJobSetupSheetPrefill(sheets, jobId) {
  if (!jobId) return { state: "unselected", draft: null };
  const matches = (Array.isArray(sheets) ? sheets : []).filter(
    (sheet) => sheet?.job_id === jobId && isOwnerApprovedSetupSheet(sheet),
  );
  if (matches.length === 0) return { state: "missing", draft: null };
  if (matches.length > 1) return { state: "ambiguous", draft: null };
  return { state: "approved_manual", draft: {}, sheet: matches[0] };
}

export function canSubmitPurchaseOrder({ saving, jobId, ownerConfirmed }) {
  return !saving && Boolean(jobId) && ownerConfirmed === true;
}

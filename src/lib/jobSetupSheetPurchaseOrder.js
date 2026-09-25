// Optional bridge to the JobSetupSheets entity introduced by PR #3. Keep this
// deliberately narrow: only confirmed sheets and fields that exist verbatim on
// that record may become a draft. Nothing here issues or persists a PO.
const PREFILL_FIELDS = ["vendor", "vendor_quote_ref", "amount_dealer", "amount_customer"];

const presentText = (value) => typeof value === "string" && value.trim() !== "";
const presentAmount = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export function purchaseOrderDraftFromSetupSheet(sheet) {
  if (!sheet || sheet.status !== "confirmed") return null;

  const draft = {};
  for (const field of PREFILL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(sheet, field)) continue;
    const value = sheet[field];
    if (field.startsWith("amount_")) {
      if (presentAmount(value)) draft[field] = String(value);
    } else if (presentText(value)) {
      draft[field] = value.trim();
    }
  }
  return draft;
}

export function selectJobSetupSheetPrefill(sheets, jobId) {
  if (!jobId) return { state: "unselected", draft: null };
  const matches = (Array.isArray(sheets) ? sheets : []).filter(
    (sheet) => sheet?.job_id === jobId && sheet?.status === "confirmed",
  );
  if (matches.length === 0) return { state: "missing", draft: null };
  if (matches.length > 1) return { state: "ambiguous", draft: null };
  return { state: "ready", draft: purchaseOrderDraftFromSetupSheet(matches[0]), sheet: matches[0] };
}

export function canSubmitPurchaseOrder({ saving, jobId, ownerConfirmed }) {
  return !saving && Boolean(jobId) && ownerConfirmed === true;
}

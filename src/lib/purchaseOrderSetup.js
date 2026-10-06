const text = value => String(value ?? "").trim();

export function approvedSetupSheetContext(sheets, jobId) {
  const matching = (Array.isArray(sheets) ? sheets : []).filter(sheet =>
    text(sheet?.job_id) === text(jobId) &&
    text(sheet?.status).toLowerCase() === "approved" &&
    text(sheet?.approver_name) &&
    text(sheet?.approved_date)
  );

  if (matching.length !== 1) {
    return {
      ok: false,
      reason: matching.length > 1 ? "ambiguous" : "missing_approval",
    };
  }

  const sheet = matching[0];
  return {
    ok: true,
    context: {
      job_id: text(sheet.job_id),
      job_name: text(sheet.job_name),
      setup_sheet_id: text(sheet.id),
      setup_sheet_approver_name: text(sheet.approver_name),
      setup_sheet_approved_date: text(sheet.approved_date),
    },
  };
}

export function jobMatchesPurchaseOrderSearch(job, query) {
  const needle = text(query).toLowerCase();
  if (!needle) return true;
  return [
    job?.canonical_name,
    job?.id,
    ...(Array.isArray(job?.po_numbers) ? job.po_numbers : []),
    ...(Array.isArray(job?.oe_numbers) ? job.oe_numbers : []),
  ].some(value => text(value).toLowerCase().includes(needle));
}

export function purchaseOrderSubmission({ form, context, reviewed }) {
  const jobId = text(form?.job_id);
  if (!jobId || (context && (!reviewed || !context.setup_sheet_id || context.job_id !== jobId))) return null;
  return {
    job_id: jobId,
    job_name: text(form?.job_name),
    builder: text(form?.builder),
    customer_name: text(form?.customer_name),
    ...(context ? {setup_sheet_id: context.setup_sheet_id, review_confirmed: true} : {}),
    vendor: text(form?.vendor),
    vendor_quote_ref: text(form?.vendor_quote_ref),
    amount_dealer: text(form?.amount_dealer),
    amount_customer: text(form?.amount_customer),
    notes: text(form?.notes),
  };
}

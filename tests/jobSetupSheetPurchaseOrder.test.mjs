import test from "node:test";
import assert from "node:assert/strict";
import { canSubmitPurchaseOrder, purchaseOrderDraftFromSetupSheet, selectJobSetupSheetPrefill } from "../src/lib/jobSetupSheetPurchaseOrder.js";

test("missing and ambiguous confirmed setup sheets never prefill", () => {
  assert.equal(selectJobSetupSheetPrefill([], "job-1").state, "missing");
  const duplicate = [
    { id: "a", job_id: "job-1", status: "confirmed", vendor: "A" },
    { id: "b", job_id: "job-1", status: "confirmed", vendor: "B" },
  ];
  assert.deepEqual(selectJobSetupSheetPrefill(duplicate, "job-1"), { state: "ambiguous", draft: null });
});

test("only explicit fields from one confirmed sheet become a draft", () => {
  const sheet = {
    id: "sheet-1", job_id: "job-1", status: "confirmed", vendor: "  AMSCO ",
    vendor_quote_ref: "Q-42", amount_dealer: 1250.5, inferred_vendor: "Do not use",
  };
  assert.deepEqual(purchaseOrderDraftFromSetupSheet(sheet), {
    vendor: "AMSCO", vendor_quote_ref: "Q-42", amount_dealer: "1250.5",
  });
  assert.equal(purchaseOrderDraftFromSetupSheet({ ...sheet, status: "draft" }), null);
});

test("multiple purchase orders for a job do not affect setup-sheet selection", () => {
  const sheets = [{ id: "sheet-1", job_id: "job-1", status: "confirmed", vendor: "Pella" }];
  const existingPurchaseOrders = [{ job_id: "job-1" }, { job_id: "job-1" }];
  assert.equal(existingPurchaseOrders.length, 2);
  assert.equal(selectJobSetupSheetPrefill(sheets, "job-1").state, "ready");
});

test("issuing requires an explicit owner review submit state", () => {
  assert.equal(canSubmitPurchaseOrder({ saving: false, jobId: "job-1", ownerConfirmed: false }), false);
  assert.equal(canSubmitPurchaseOrder({ saving: false, jobId: "job-1", ownerConfirmed: true }), true);
  assert.equal(canSubmitPurchaseOrder({ saving: true, jobId: "job-1", ownerConfirmed: true }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canSubmitPurchaseOrder,
  isOwnerApprovedSetupSheet,
  purchaseOrderDraftFromSetupSheet,
  selectJobSetupSheetPrefill,
} from "../src/lib/jobSetupSheetPurchaseOrder.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/job-setup-sheet-pr3.json", import.meta.url), "utf8"));

test("PR #3 approved sheet requires its approver and approval date", () => {
  assert.equal(isOwnerApprovedSetupSheet(fixture), true);
  assert.equal(isOwnerApprovedSetupSheet({ ...fixture, status: "sent_for_approval" }), false);
  assert.equal(isOwnerApprovedSetupSheet({ ...fixture, approved_by: "" }), false);
  assert.equal(isOwnerApprovedSetupSheet({ ...fixture, approved_at: "" }), false);
});

test("nested whole-job costs and pricing never become vendor-specific PO values", () => {
  assert.deepEqual(purchaseOrderDraftFromSetupSheet(fixture), {});
  const selected = selectJobSetupSheetPrefill([fixture], fixture.job_id);
  assert.equal(selected.state, "approved_manual");
  assert.deepEqual(selected.draft, {});
  assert.equal("vendor" in selected.draft, false);
  assert.equal("vendor_quote_ref" in selected.draft, false);
  assert.equal("amount_dealer" in selected.draft, false);
  assert.equal("amount_customer" in selected.draft, false);
});

test("missing and ambiguous approved setup sheets fail closed", () => {
  assert.deepEqual(selectJobSetupSheetPrefill([], "job-1"), { state: "missing", draft: null });
  assert.deepEqual(
    selectJobSetupSheetPrefill([fixture, { ...fixture, id: "setup-sheet-2" }], fixture.job_id),
    { state: "ambiguous", draft: null },
  );
});

test("multiple purchase orders for a job do not affect setup-sheet selection", () => {
  const existingPurchaseOrders = [{ job_id: fixture.job_id }, { job_id: fixture.job_id }];
  assert.equal(existingPurchaseOrders.length, 2);
  assert.equal(selectJobSetupSheetPrefill([fixture], fixture.job_id).state, "approved_manual");
});

test("issuing requires an explicit owner review submit state", () => {
  assert.equal(canSubmitPurchaseOrder({ saving: false, jobId: "job-1", ownerConfirmed: false }), false);
  assert.equal(canSubmitPurchaseOrder({ saving: false, jobId: "job-1", ownerConfirmed: true }), true);
  assert.equal(canSubmitPurchaseOrder({ saving: true, jobId: "job-1", ownerConfirmed: true }), false);
});

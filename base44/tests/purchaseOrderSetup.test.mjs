import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedSetupSheetContext,
  jobMatchesPurchaseOrderSearch,
  purchaseOrderSubmission,
} from "../../src/lib/purchaseOrderSetup.js";

const approved = {
  id: "sheet-approved", job_id: "job-1", job_name: "Pine Ridge",
  status: "approved", approver_name: "Gabe Fronk", approved_date: "2026-09-24",
  costs: { whole_job: 12000 }, pricing: { total: 18000 },
  sources: [{ amount: 9999 }], scope: { amount: 8888 },
};
const draft = {
  id: "sheet-draft", job_id: "job-1", job_name: "Pine Ridge draft",
  status: "draft", approver_name: "", approved_date: "",
};

test("accepts exactly one PR #3-shaped approved sheet and records its audit fields", () => {
  assert.deepEqual(approvedSetupSheetContext([draft, approved], "job-1"), {
    ok: true,
    context: {
      job_id: "job-1", job_name: "Pine Ridge", setup_sheet_id: "sheet-approved",
      setup_sheet_approver_name: "Gabe Fronk", setup_sheet_approved_date: "2026-09-24",
    },
  });
});

test("fails closed for draft, incomplete approval audit, and ambiguous approvals", () => {
  assert.equal(approvedSetupSheetContext([draft], "job-1").reason, "missing_approval");
  assert.equal(approvedSetupSheetContext([{ ...approved, approver_name: "" }], "job-1").reason, "missing_approval");
  assert.equal(approvedSetupSheetContext([{ ...approved, approved_date: "" }], "job-1").reason, "missing_approval");
  assert.equal(approvedSetupSheetContext([approved, { ...approved, id: "sheet-2" }], "job-1").reason, "ambiguous");
});

test("never invents PO amounts from nested whole-job setup-sheet data", () => {
  const { context } = approvedSetupSheetContext([approved], "job-1");
  assert.deepEqual(purchaseOrderSubmission({ form: {job_id: "job-1", vendor: "AMSCO" }, context, reviewed: true }), {
    job_id: "job-1", job_name: "", builder: "", customer_name: "", setup_sheet_id: "sheet-approved", review_confirmed: true,
    vendor: "AMSCO", vendor_quote_ref: "", amount_dealer: "", amount_customer: "", notes: "",
  });
});

test("requires explicit review before a submission can be created", () => {
  const { context } = approvedSetupSheetContext([approved], "job-1");
  assert.equal(purchaseOrderSubmission({ form: {job_id: "job-1"}, context, reviewed: false }), null);
  assert.ok(purchaseOrderSubmission({ form: {job_id: "job-1"}, context, reviewed: true }));
});

test("searches jobs by name, ID, BFS PO, OE, and YA PO and permits multiple POs", () => {
  const job = { id: "job-1", canonical_name: "Pine Ridge", po_numbers: ["BFS-77", "YA-0003", "YA-0008"], oe_numbers: ["OE-42"] };
  for (const query of ["pine", "job-1", "bfs-77", "oe-42", "ya-0008"]) assert.equal(jobMatchesPurchaseOrderSearch(job, query), true);
  assert.equal(job.po_numbers.filter(value => value.startsWith("YA-")).length, 2);
});

test("manual PO works with no sheet, draft, or ambiguous approval", () => {
  const form={job_id:"job-1", job_name:"Pine Ridge", vendor:"AMSCO", amount_dealer:"500"};
  for(const sheets of [[],[draft],[approved,{...approved,id:"sheet-2"}]]){
    const result=approvedSetupSheetContext(sheets,"job-1");
    assert.equal(result.ok,false);
    assert.deepEqual(purchaseOrderSubmission({form,context:null,reviewed:false}),{
      job_id:"job-1",job_name:"Pine Ridge",builder:"",customer_name:"",vendor:"AMSCO",vendor_quote_ref:"",amount_dealer:"500",amount_customer:"",notes:""
    });
  }
  assert.equal(purchaseOrderSubmission({form:{},context:null,reviewed:false}),null);
});

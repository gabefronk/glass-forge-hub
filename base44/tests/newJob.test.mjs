import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateJobs, newJobPayload, normalizeJobText } from "../../src/lib/newJob.js";

test("normalizes whitespace and builds only the supported job fields", () => {
  assert.equal(normalizeJobText("  Pine   Ridge\n Lot 4  "), "Pine Ridge Lot 4");
  assert.deepEqual(newJobPayload({
    canonical_name: "  Pine   Ridge  ", builder: " ACME ", address: " 10  Main St ",
    po_number: " PO-7 ", oe_number: "   ", ignored_price: "999",
  }), {
    canonical_name: "Pine Ridge", builder: "ACME", address: "10 Main St", po_numbers: ["PO-7"],
  });
});

test("finds address duplicates case-insensitively with normalized whitespace", () => {
  const jobs = [
    { id: "one", address: "10 Main Street", canonical_name: "First" },
    { id: "two", address: "20 Side Street", canonical_name: "Second" },
  ];
  assert.deepEqual(findDuplicateJobs(jobs, { address: "  10   MAIN street " }).map((j) => j.id), ["one"]);
});

test("finds exact normalized PO or OE duplicates and ignores blank identifiers", () => {
  const jobs = [
    { id: "po", po_numbers: ["PO-101"], oe_numbers: [] },
    { id: "oe", po_numbers: [], oe_numbers: ["OE 202"] },
    { id: "blank", po_numbers: [""], oe_numbers: ["  "] },
  ];
  assert.deepEqual(findDuplicateJobs(jobs, { po_number: " po-101 " }).map((j) => j.id), ["po"]);
  assert.deepEqual(findDuplicateJobs(jobs, { oe_number: "OE   202" }).map((j) => j.id), ["oe"]);
  assert.deepEqual(findDuplicateJobs(jobs, { po_number: " ", oe_number: "" }), []);
});

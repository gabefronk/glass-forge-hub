import test from "node:test";
import assert from "node:assert/strict";
import { quantityReviewLabel } from "../src/lib/quantityReview.js";

test("returns null when the review flag is absent or false", () => {
  assert.equal(quantityReviewLabel(null), null);
  assert.equal(quantityReviewLabel({}), null);
  assert.equal(quantityReviewLabel({ quote: {} }), null);
  assert.equal(quantityReviewLabel({ quote: { openings_qty_review: false } }), null);
  assert.equal(quantityReviewLabel({ quote: { openings_qty_review: null } }), null);
});

test("returns the label when the flag is true (persisted on record.quote)", () => {
  // Ingest stores the full normalized quote on record.quote, so the flag the
  // Procurement card reads is budget.quote.openings_qty_review.
  assert.equal(quantityReviewLabel({ quote: { openings_qty_review: true } }), 'Quantity needs review');
});

test("does not fire on the top-level openings_qty field alone", () => {
  // Guard: a budget with an openings_qty but no review flag is trusted (no label).
  assert.equal(quantityReviewLabel({ openings_qty: 19, quote: {} }), null);
});
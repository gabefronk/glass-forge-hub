import { test } from "node:test";
import assert from "node:assert/strict";
import { movedSummary } from "../src/lib/mergeLogs.js";

// Source-wiring regression for the combine dialogs' "Moved:" line.
// CombineJobsReview renders the aggregate `result.totals` and each per-source
// `r` through movedSummary; CombineJobsDialog renders the pairwise `result`
// through movedSummary. Both result shapes carry job_knowledge and
// field_library_projects, so movedSummary must surface them — and must not drop
// the existing categories — whether the input has relocated_link_ids (per-source
// / pairwise result) or only relocated_link_counts (aggregate result.totals).

const ALL = {
  fee_lines: 3, field_reports: 2, calendar_events: 4, job_notes: 1,
  contact_job_links: 1, job_budgets: 1, probuild_project_links: 1,
  job_knowledge: 26, field_library_projects: 1,
};

test("movedSummary renders every supported category from a counts-only totals object (combine result.totals shape)", () => {
  const s = movedSummary({ relocated_link_counts: ALL });
  assert.match(s, /3 invoice lines/);
  assert.match(s, /2 reports/);
  assert.match(s, /4 visits/);
  assert.match(s, /1 note/);
  assert.match(s, /1 contact link/);
  assert.match(s, /1 budget/);
  assert.match(s, /1 Probuild link/);
  assert.match(s, /26 knowledge briefs/);
  assert.match(s, /1 field-library project/);
});

test("movedSummary renders the mocked 26 knowledge briefs / 1 field-library project combine result", () => {
  const onlyNew = { ...ALL, fee_lines: 0, field_reports: 0, calendar_events: 0, job_notes: 0, contact_job_links: 0, job_budgets: 0, probuild_project_links: 0 };
  assert.equal(movedSummary({ relocated_link_counts: onlyNew }), "26 knowledge briefs, 1 field-library project");
});

test("movedSummary renders from a per-source merge result (relocated_link_ids lengths win over counts)", () => {
  const r = {
    relocated_link_ids: {
      fee_lines: ["a", "b"], calendar_events: ["c"], field_reports: [], job_notes: ["d"],
      contact_job_links: [], job_budgets: ["e"], probuild_project_links: [],
      job_knowledge: Array.from({ length: 26 }, (_, i) => `k${i}`), field_library_projects: ["fl1"],
    },
    relocated_link_counts: { fee_lines: 99, job_knowledge: 99, field_library_projects: 99 },
  };
  const s = movedSummary(r);
  assert.match(s, /2 invoice lines/);
  assert.match(s, /1 visit/);
  assert.match(s, /1 note/);
  assert.match(s, /1 budget/);
  assert.match(s, /26 knowledge briefs/);
  assert.match(s, /1 field-library project/);
});

test("movedSummary: nothing moved reads 'no linked records' (counts-only, all zero)", () => {
  assert.equal(movedSummary({ relocated_link_counts: {} }), "no linked records");
});
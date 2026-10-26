import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanJobName, planUnlinkedLinks } from '../shared/unlinkedLinkPlan.js';

const JOBS = [
  { id: 'j202', canonical_name: 'holmes homes 202 deer springs' },
  { id: 'j424', canonical_name: 'holmes homes - 424 oquirrh west', oe_numbers: ['79666150-01'] },
  { id: 'jOld', canonical_name: 'holmes 424 old', merged_into: 'j424' },
  { id: 'jX1', canonical_name: 'x3 homes - 23 wildwood' },
  { id: 'jX2', canonical_name: 'x3 homes - 23 wildwood' },
  { id: 'jP14', canonical_name: 'pulte home - the peaks bldg 14 unit 14' },
];
const linked = (patch) => ({ id: `L${Math.random()}`, match_confidence: 'high', billable: true, ...patch });
const open = (patch) => ({ billable: true, ...patch });

test('cleanJobName strips crew prefixes and punctuation', () => {
  assert.equal(cleanJobName('YA - #1 (l.i) Holmes Homes 202 Deer Springs '), 'holmes homes 202 deer springs');
  assert.equal(cleanJobName('YA - #2 (2-3 techs) (l.i) Edge 912 Harmony Ridge'), 'edge 912 harmony ridge');
  assert.equal(cleanJobName('ETA - Taira Res'), 'taira res');
});

test('links a ProBuild line by exact name when earlier lines with that name agree', () => {
  const fees = [
    linked({ job_id: 'j202', job_name_raw: 'YA - #1 Holmes Homes 202 Deer Springs' }),
    { id: 'u1', job_name_raw: 'YA - #1 (l.i) Holmes Homes 202 Deer Springs ', billable: true, needs_review: true, service_review_status: 'ready' },
    { id: 'u2', job_name_raw: 'YA - #1 (l.i) Holmes Homes 202 Deer Springs ', billable: false },
  ];
  const plan = planUnlinkedLinks({ jobs: JOBS, fees });
  assert.deepEqual(plan.fee_lines, [{ id: 'u1', job_id: 'j202', match_confidence: 'high', needs_review: false }]);
});

test('a name match alone is not enough', () => {
  const plan = planUnlinkedLinks({ jobs: JOBS, fees: [open({ id: 'u1', job_name_raw: 'Holmes Homes 202 Deer Springs' })] });
  assert.equal(plan.fee_lines.length, 0);
});

test('OE number links and follows a merged job to the survivor', () => {
  const jobs = JOBS.map((j) => (j.id === 'j424' ? { ...j, oe_numbers: [] } : j.id === 'jOld' ? { ...j, oe_numbers: ['79666150-01'] } : j));
  const plan = planUnlinkedLinks({ jobs, fees: [open({ id: 'u1', job_name_raw: 'Holmes Homes - 424 Oquirrh West', oe_number: '79666150-01' })] });
  assert.equal(plan.fee_lines[0].job_id, 'j424');
});

test('pricing or service review keeps the line held; a line not held stays not held', () => {
  const fees = [
    linked({ job_id: 'j202', job_name_raw: 'Holmes Homes 202 Deer Springs' }),
    open({ id: 'u1', job_name_raw: 'Holmes Homes 202 Deer Springs', needs_review: true, pricing_review_reason: 'Man-hour quantity is not explicit.' }),
    open({ id: 'u2', job_name_raw: 'Holmes Homes 202 Deer Springs', needs_review: true, service_review_status: 'review' }),
    open({ id: 'u3', job_name_raw: 'Holmes Homes 202 Deer Springs', needs_review: false, pricing_review_reason: 'x' }),
  ];
  const by = Object.fromEntries(planUnlinkedLinks({ jobs: JOBS, fees }).fee_lines.map((p) => [p.id, p.needs_review]));
  assert.deepEqual(by, { u1: true, u2: true, u3: false });
});

test('duplicate jobs with one name are skipped', () => {
  const fees = [
    linked({ job_id: 'jX1', job_name_raw: 'X3 Homes - 23 Wildwood' }),
    open({ id: 'u1', job_name_raw: 'YA - #1 X3 Homes 23 Wildwood' }),
  ];
  assert.equal(planUnlinkedLinks({ jobs: JOBS, fees }).fee_lines.length, 0);
});

test('earlier lines on another job do not carry a different unit', () => {
  const fees = [
    linked({ job_id: 'jP14', job_name_raw: 'YA - #1 Pulte Bldg. 14 Unit 117 The Peaks' }),
    open({ id: 'u1', job_name_raw: 'YA - #1 Pulte Bldg. 14 Unit 117 The Peaks' }),
  ];
  assert.equal(planUnlinkedLinks({ jobs: JOBS, fees }).fee_lines.length, 0);
});

test('hard evidence that disagrees with the name is ambiguous', () => {
  const fees = [
    linked({ job_id: 'j202', job_name_raw: 'Holmes Homes 202 Deer Springs' }),
    open({ id: 'u1', job_name_raw: 'Holmes Homes 202 Deer Springs', oe_number: '79666150-01' }),
  ];
  const plan = planUnlinkedLinks({ jobs: JOBS, fees });
  assert.equal(plan.fee_lines.length, 0);
  assert.equal(plan.skipped_ambiguous, 1);
});

test('events and reports link from a high-confidence line, including lines linked in the same plan', () => {
  const fees = [
    linked({ job_id: 'j202', job_name_raw: 'Holmes Homes 202 Deer Springs' }),
    open({ id: 'u1', job_name_raw: 'Holmes Homes 202 Deer Springs', probuild_post_id: 'post1', calendar_event_id: 'g1' }),
  ];
  const events = [{ id: 'e1', google_event_id: 'g1', job_name: 'Something else entirely' }, { id: 'e2', google_event_id: 'g2', job_id: 'jX1' }];
  const reports = [{ id: 'r1', post_id: 'post1', job_name: 'YA - #1 Holmes Homes 202 Deer Springs' }];
  const plan = planUnlinkedLinks({ jobs: JOBS, fees, events, reports });
  assert.deepEqual(plan.calendar_events, [{ id: 'e1', job_id: 'j202' }]);
  assert.deepEqual(plan.field_reports, [{ id: 'r1', job_id: 'j202' }]);
});

test('a billing line takes the job of the field report it came from; linked and billed lines are untouched', () => {
  const fees = [
    open({ id: 'u1', job_name_raw: 'Odd name', probuild_post_id: 'post9' }),
    open({ id: 'u2', job_name_raw: 'Odd name', job_id: 'jX1' }),
    open({ id: 'u3', job_name_raw: 'Odd name', probuild_post_id: 'post9', billed_to_bfs: true }),
  ];
  const plan = planUnlinkedLinks({ jobs: JOBS, fees, reports: [{ id: 'r9', post_id: 'post9', job_id: 'j202' }] });
  assert.deepEqual(plan.fee_lines.map((p) => [p.id, p.job_id]), [['u1', 'j202']]);
});

test('ProBuild project link links a field report', () => {
  const plan = planUnlinkedLinks({ jobs: JOBS, reports: [{ id: 'r1', project_id: 'p1', job_name: 'whatever' }], projectLinks: [{ project_id: 'p1', job_id: 'jOld' }] });
  assert.deepEqual(plan.field_reports, [{ id: 'r1', job_id: 'j424' }]);
});

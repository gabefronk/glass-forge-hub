import test from 'node:test';
import assert from 'node:assert/strict';
import { packageProgress, packageStatus } from '../src/components/window-quotes/packageProgress.js';
const quote = () => ({ input_revision: 1, worker_status: 'queued', lines: [{ id: 'a', qty: 2 }, { id: 'b', qty: 1 }],
  pricing_progress: { version: 1, package_id: 'package', input_revision: 1, total_count: 2, priced_count: 1, native_pending_count: 0, online_pending_count: 1, priced_subtotal: 200, total: null,
    lines: [{ index: 0, status: 'priced', total: 200 }, { index: 1, status: 'online_pending' }] } });
test('partial and stale totals never appear as a complete quote', () => {
  const q = quote(); q.pricing_progress.total = 200;
  assert.equal(packageProgress(q).total, null); assert.equal(packageProgress(q).complete, false);
  q.input_revision++; assert.equal(packageProgress(q), null); assert.equal(packageStatus(q), null);
});
test('online work is described separately from missing product choices', () => {
  const q = quote(); assert.equal(packageStatus(q).label, 'AMSCO pricing'); assert.match(packageStatus(q).text, /online quote/);
  q.worker_status = 'needs_details'; assert.equal(packageProgress(q).needsRevision, true); assert.equal(packageProgress(q).canResume, false); assert.match(packageStatus(q).text, /Revise windows/);
});
test('a failed or sign-in interrupted package retains subtotal and offers resume', () => {
  for (const worker_status of ['failed', 'needs_sign_in']) { const q = { ...quote(), worker_status }; assert.equal(packageProgress(q).canResume, true); assert.equal(packageProgress(q).priced_subtotal, 200); assert.match(packageStatus(q).text, /resume/i); }
});
test('completion requires all windows and the verified final result', () => {
  const q = quote(); q.worker_status = 'ready'; q.pricing_progress.priced_count = 2;
  assert.equal(packageProgress(q).complete, false);
  q.result = { verified: true, totals: { customer_total: 350 } }; assert.equal(packageProgress(q).complete, true); assert.equal(packageProgress(q).total, 350);
});

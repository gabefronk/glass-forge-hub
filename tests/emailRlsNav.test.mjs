// Regression: EmailMailbox, EmailAgentRun and EmailRelay RLS must be id-based owner-only
// (Gabriel's two auth ids) on all four actions — not admin/role-based. The Inbox Agents nav
// link in both sidebars must be gated by isEmailOwner (id-based), separate from the shared
// isAgentCenterOwner (email-based) used by the other admin tools. Scheduled sync's
// anonymous-gap is left unresolved by design (owner decision pending); this test does NOT
// assert sync auth.

import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const OWNER_IDS = ['6a7f0d834a5f825c724273ea', '6a8229a9801b2aef9278ff47'];
const ACTIONS = ['read', 'create', 'update', 'delete'];

function assertOwnerRls(entityName) {
  const schema = readJson(`base44/entities/${entityName}.jsonc`);
  assert.ok(schema.rls, `${entityName} has no rls`);
  for (const action of ACTIONS) {
    assert.ok(schema.rls[action], `${entityName} missing rls.${action}`);
    const cond = schema.rls[action];
    assert.ok(cond.$or, `${entityName} rls.${action} must be an $or list`);
    assert.equal(cond.$or.length, 2, `${entityName} rls.${action} must list exactly the two owner ids`);
    const ids = cond.$or.map((c) => c.user_condition?.id).sort();
    assert.deepEqual(ids, [...OWNER_IDS].sort(), `${entityName} rls.${action} must be the Gabriel id $or`);
    // reject role-based admin gates
    for (const c of cond.$or) assert.equal(c.user_condition?.role, undefined, `${entityName} rls.${action} must not be role-based`);
  }
}

test('EmailRelay, EmailMailbox and EmailAgentRun RLS are id-based owner-only on all four actions', () => {
  assertOwnerRls('EmailRelay');
  assertOwnerRls('EmailMailbox');
  assertOwnerRls('EmailAgentRun');
});

// The Inbox Agents feature was retired (owner Oct 24); its tables stay, owner-only, for history.
test('the retired Inbox Agents page and nav links are gone from both sidebars', () => {
  const sidebar = readFileSync(join(ROOT, 'src/components/YaFeesSidebar.jsx'), 'utf8');
  const mobile = readFileSync(join(ROOT, 'src/components/MobileBottomNav.jsx'), 'utf8');
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  for (const src of [sidebar, mobile, app]) assert.ok(!/inbox-agents|InboxAgents/.test(src));
});
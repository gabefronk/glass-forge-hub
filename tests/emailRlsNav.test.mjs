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

test('canViewInboxAgents is id-based owner-only (not role/email-based)', async () => {
  const { canViewInboxAgents } = await import('../src/lib/inboxAgents.js');
  for (const id of OWNER_IDS) assert.equal(canViewInboxAgents({ id, role: 'admin' }), true, `owner id ${id} allowed`);
  assert.equal(canViewInboxAgents({ id: 'other', role: 'admin' }), false, 'non-owner admin denied');
  assert.equal(canViewInboxAgents({ role: 'admin' }), false, 'no id denied');
  assert.equal(canViewInboxAgents({ role: 'manager' }), false);
  assert.equal(canViewInboxAgents(null), false);
});

test('Inbox Agents nav link is gated by isEmailOwner (emailOwnerOnly) in both sidebars, not the shared owner gate', () => {
  const sidebar = readFileSync(join(ROOT, 'src/components/YaFeesSidebar.jsx'), 'utf8');
  const mobile = readFileSync(join(ROOT, 'src/components/MobileBottomNav.jsx'), 'utf8');
  // both import isEmailOwner from the id-based owner module
  assert.match(sidebar, /import \{ isEmailOwner \} from "@\/lib\/ownerAccess"/);
  assert.match(mobile, /import \{ isEmailOwner \} from "@\/lib\/ownerAccess"/);
  // the Inbox Agents item carries the emailOwnerOnly flag in both
  assert.match(sidebar, /\{ label: "Inbox Agents"[^}]*emailOwnerOnly: true[^}]*\}/);
  assert.match(mobile, /\{ label: "Inbox Agents"[^}]*emailOwnerOnly: true[^}]*\}/);
  // both filter the admin list with isEmailOwner for emailOwnerOnly items
  assert.match(sidebar, /ADMIN_ITEMS\.filter\(\(item\) => !item\.emailOwnerOnly \|\| isEmailOwner\(user\)\)/);
  assert.match(mobile, /ADMIN_NAV\.filter\(\(item\) => !item\.emailOwnerOnly \|\| emailOwner\)/);
  // the shared isAgentCenterOwner helper is untouched (still present, still email-based)
  assert.match(sidebar, /isAgentCenterOwner/);
  assert.match(mobile, /isAgentCenterOwner/);
});
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { createEmailAgentHandler } from '../../shared/emailAgent.js';

// Inbox agents: one per EmailMailbox row (Glass Forge Gmail, YA Install Outlook). The mail
// stays in the mailbox; the Hub keeps only an EmailRelay ledger row per thread (what the
// agent concluded and what it changed). POST { action, ... }:
//   sync            scheduled (no user) or owner — pull, triage, apply job facts, relay a note +
//                   to-do, label in the mailbox, draft a reply in the mailbox (never sends).
//                   NOTE: the scheduled-vs-public-anonymous discriminator is not verified in
//                   code; the sync path is treated as anonymously callable (owner decision
//                   pending). It returns only per-mailbox counters, never mail bodies.
//   list / entry    owner only (id-based) — every mailbox is owner-only, not admin-only
//   set_status, rerun, set_category, link_job, unlink_job, regenerate_draft, discard_draft, archive
//                   owner only (id-based) — no non-owner (admin, manager, user) may read any
//                   mailbox body, metadata, attachment, draft or tax row (owner's ruling 2026-10-06)
//   mailboxes, seed_mailboxes   owner only (id-based)
// All logic lives in base44/shared/emailAgent.js (+ emailParse / emailTriage / emailProviders)
// so it is unit-tested under Node; this entry only wires the SDK client.

const handler = createEmailAgentHandler({ getClient: (req) => createClientFromRequest(req) });

export default async function emailAgent(req) {
  return handler(req);
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { createEmailAgentHandler } from '../../shared/emailAgent.js';

// Inbox agents: one per EmailMailbox row (Glass Forge Gmail, YA Install Outlook). The mail
// stays in the mailbox; the Hub keeps only an EmailRelay ledger row per thread (what the
// agent concluded and what it changed). POST { action, ... }:
//   sync            scheduled (no user) or admin — pull, triage, apply job facts, relay a note +
//                   to-do, label in the mailbox, draft a reply in the mailbox (never sends)
//   list / entry    admin + manager; owner-only mailboxes only for the owner emails
//   set_status, set_category, link_job, unlink_job, regenerate_draft, discard_draft, archive
//                   admin + manager
//   mailboxes, seed_mailboxes   admin only
// All logic lives in base44/shared/emailAgent.js (+ emailParse / emailTriage / emailProviders)
// so it is unit-tested under Node; this entry only wires the SDK client.

const handler = createEmailAgentHandler({ getClient: (req) => createClientFromRequest(req) });

export default async function emailAgent(req) {
  return handler(req);
}

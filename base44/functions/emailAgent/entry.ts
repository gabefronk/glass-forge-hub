import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { createEmailAgentHandler } from '../../shared/emailAgent.js';

// Inbox agents: one per EmailMailbox row (Glass Forge Gmail, YA Install Outlook).
// POST { action, ... }:
//   sync            scheduled (no user) or admin — pull, triage, relay, label, draft (never sends)
//   list / thread   admin + manager; owner-only mailboxes only for the owner emails
//   set_status, set_category, link_job, unlink_job, regenerate_draft, discard_draft, archive
//                   admin + manager
//   send_draft      admin only — sends the stored provider draft
//   mailboxes, seed_mailboxes   admin only
// All logic lives in base44/shared/emailAgent.js (+ emailParse / emailTriage / emailProviders)
// so it is unit-tested under Node; this entry only wires the SDK client.

const handler = createEmailAgentHandler({ getClient: (req) => createClientFromRequest(req) });

export default async function emailAgent(req) {
  return handler(req);
}

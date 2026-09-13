import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';
import { executeDailyRuns } from './agentOpsRoles.js';
import { prepareDailyKnowledge } from './jobKnowledgeDaily.ts';

// Autonomous daily operations runner. Invoked each morning by the "Daily Agent
// Runs" workflow (no user) and manually from the Agent Center (owner only).
// For each enabled section lead it reconciles internal status, records a run,
// and the Glass Forge manager escalates only true exceptions to the owner.
// Performs no external messages, purchases, or payment actions.
Deno.serve(async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') return Response.json({ error: 'Owner access required.' }, { status: 403 });
    const input = await req.json().catch(() => ({}));
    const ctx = { entities: base44.asServiceRole.entities, connectors: base44.asServiceRole.connectors, secrets };
    const triggeredBy = input.triggered_by === 'manual' ? 'manual' : 'scheduler';
    const onlyLeadId = input.lead_id || null;
    const jobKnowledge = await prepareDailyKnowledge(base44, { triggeredBy, onlyLeadId });
    const result = await executeDailyRuns(ctx, { triggeredBy, onlyLeadId });
    return Response.json({ ...result, job_knowledge: jobKnowledge });
  } catch (error) {
    return Response.json({ error: error.message || 'Daily operations run failed.' }, { status: 500 });
  }
});

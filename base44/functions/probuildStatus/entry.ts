import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Returns the authenticated Probuild team ID and last sync timestamps.
// Used by the Invoicing header to surface connection status on screen.
const TEAM_ID = '-O7aXXhvthc41u60Koc6';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Last token exchange (proxy for "when did we last talk to Probuild")
    const authRecords = await base44.asServiceRole.entities.ProbuildAuth.list('-updated_date', 1);
    const lastExchangedAt = authRecords.length > 0 ? authRecords[0].last_exchanged_at : null;

    // Last audit run (when did the matcher last evaluate events)
    const audits = await base44.asServiceRole.entities.ReportAudit.list('-ran_at', 1);
    const lastAuditAt = audits.length > 0 ? audits[0].ran_at : null;

    return Response.json({
      team_id: TEAM_ID,
      last_exchanged_at: lastExchangedAt,
      last_audit_at: lastAuditAt,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 200 });
  }
}
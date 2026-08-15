import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Alert emailer for the daily ingest workflow. Invoked by the workflow when an
// ingest function returns an `error` field. Emails every admin user. Runs as
// service role (no user context in a scheduled workflow).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const source = body.source || 'ingest';
    const detail = body.detail || 'No detail provided.';

    const users = await base44.asServiceRole.entities.User.list('-created_date', 100);
    const recipients = (users.filter((u) => u.role === 'admin').length
      ? users.filter((u) => u.role === 'admin')
      : users
    ).map((u) => u.email).filter(Boolean);

    let sent = 0;
    for (const email of recipients) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: email,
        subject: `Glass Forge ingest failure: ${source}`,
        body: `The daily ${source} ingest failed and was NOT retried.\n\nDetail:\n${detail}\n\nCheck the Workflows dashboard, fix the cause, and re-run manually.`,
      });
      sent++;
    }
    return Response.json({ alerted: true, sent, recipients });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 200 });
  }
}
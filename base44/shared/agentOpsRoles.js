// Autonomous daily operations roles + reconciliation for the Agent Center.
// Backend-only: shared by the runDailyOperations function. The frontend keeps
// its own copy of the daily-plan text in src/lib/agentCenterRoles.js for the
// dropdowns; this module is the authoritative source the scheduler uses.

export const SECTION_LEADS = [
  { id: 'calendar_ops_lead', name: 'Calendar Operations Lead', department: 'Operations · Lead', label: 'Calendar Operations', connector: 'googlecalendar', connectorLabel: 'Google Calendar', plan: [
    { phase: 'Review', task: "Review Calendar coordinator's reconciled event and report status." },
    { phase: 'Reconcile / produce', task: 'Confirm calendar and report-status updates are complete.' },
    { phase: 'Record', task: 'Send a daily section summary to the Glass Forge manager.' },
    { phase: 'Escalate', task: 'Flag unresolved compliance or scheduling blockers.' },
  ] },
  { id: 'sales_order_lead', name: 'Sales & Order Lead', department: 'Operations · Lead', label: 'Sales & Order', connector: null, plan: [
    { phase: 'Review', task: 'Review Sales Tracker order, ETA, and OE/PO verification feed.' },
    { phase: 'Reconcile / produce', task: 'Confirm customer and order verification against the calendar.' },
    { phase: 'Record', task: 'Send a daily section summary to the Glass Forge manager.' },
    { phase: 'Escalate', task: 'Flag unverified orders or ETA slips.' },
  ] },
  { id: 'field_reporting_lead', name: 'Field Reporting Lead', department: 'Operations · Lead', label: 'Field Reporting', connector: 'probuild', connectorLabel: 'ProBuild', plan: [
    { phase: 'Review', task: 'Review ProBuild field reports — photos, notes, man-hours.' },
    { phase: 'Reconcile / produce', task: 'Confirm evidence handoff to Calendar coordinator is complete.' },
    { phase: 'Record', task: 'Send a daily section summary to the Glass Forge manager.' },
    { phase: 'Escalate', task: 'Flag missing or incomplete field reports.' },
  ] },
  { id: 'quoting_lead', name: 'Quoting Lead', department: 'Product Engineering · Lead', label: 'Quoting', connector: 'superagent', connectorLabel: 'External Claude quoting', plan: [
    { phase: 'Review', task: 'Review Construction Plan Quoting takeoffs and External Claude results.' },
    { phase: 'Reconcile / produce', task: 'Confirm quote drafts and escalations are ready.' },
    { phase: 'Record', task: 'Send a daily section summary to the Glass Forge manager.' },
    { phase: 'Escalate', task: 'Flag product review or pricing blockers.' },
  ] },
  { id: 'development_lead', name: 'Development Lead', department: 'Product Engineering · Lead', label: 'Development', connector: null, plan: [
    { phase: 'Review', task: 'Review Glass Forge development status and integration health.' },
    { phase: 'Reconcile / produce', task: 'Confirm features, fixes, and approved results.' },
    { phase: 'Record', task: 'Send a daily section summary to the Glass Forge manager.' },
    { phase: 'Escalate', task: 'Flag build or integration failures.' },
  ] },
];

export const DEFAULT_ENABLEMENT = Object.fromEntries(SECTION_LEADS.map(l => [l.id, true]));

const MISSING_REPORT_STATES = ['missing_all', 'missing_photos', 'missing_notes'];

export async function checkConnector(kind, ctx) {
  try {
    if (kind === 'googlecalendar' || kind === 'googledrive') {
      const c = await ctx.connectors.getConnection(kind);
      return Boolean(c && c.accessToken);
    }
    if (kind === 'probuild') return Boolean(ctx.secrets.get('PROBUILD_REFRESH_TOKEN'));
    if (kind === 'superagent') return Boolean(ctx.secrets.get('WINDOW_QUOTES_SUPERAGENT_API_KEY'));
  } catch { return false; }
  return false;
}

// Reconcile internal status for one lead. Read-only on business data; writes
// nothing. Returns a summary and a list of true exceptions (the five owner
// categories): missing required data, conflicting records, connector failure,
// out-of-plan task, or a new external authorization required.
export async function reconcileLead(lead, ctx) {
  const exceptions = [];
  let summary = '';
  let connectorAvailable = null;
  if (lead.connector) {
    connectorAvailable = await checkConnector(lead.connector, ctx);
    if (!connectorAvailable) exceptions.push(`Requires new external authorization: ${lead.connectorLabel} is not configured.`);
  }
  try {
    if (lead.id === 'calendar_ops_lead') {
      const events = await ctx.entities.CalendarEvents.list('-event_date', 200);
      const today = new Date().toISOString().slice(0, 10);
      const past = events.filter(e => (e.event_date || '') <= today);
      const pending = past.filter(e => e.report_status === 'pending').length;
      const missing = past.filter(e => MISSING_REPORT_STATES.includes(e.report_status)).length;
      const late = past.filter(e => MISSING_REPORT_STATES.includes(e.report_status) && (e.days_late || 0) > 0).length;
      summary = `Reconciled ${past.length} scheduled events: ${pending} pending, ${missing} missing/incomplete reports, ${late} past grace.`;
      if (late > 0) exceptions.push(`${late} calendar events have missing field reports past the grace period (missing required data).`);
    } else if (lead.id === 'sales_order_lead') {
      const quotes = await ctx.entities.QuoteRequests.list('-created_date', 100);
      const open = quotes.filter(q => q.sales_status !== 'won');
      const failed = open.filter(q => q.worker_status === 'failed').length;
      const needsDetails = open.filter(q => q.worker_status === 'needs_details').length;
      summary = `Reviewed ${open.length} open sales/order requests: ${failed} failed, ${needsDetails} need details.`;
      if (failed > 0) exceptions.push(`${failed} sales/order requests failed and need owner review (conflicting records).`);
    } else if (lead.id === 'field_reporting_lead') {
      const events = await ctx.entities.CalendarEvents.list('-event_date', 200);
      const today = new Date().toISOString().slice(0, 10);
      const past = events.filter(e => (e.event_date || '') <= today);
      const missing = past.filter(e => MISSING_REPORT_STATES.includes(e.report_status));
      const reports = await ctx.entities.FieldReports.list('-created_at', 100);
      summary = `Reconciled ${past.length} events and ${reports.length} recent field reports: ${missing.length} events missing reports.`;
      if (missing.length > 0) exceptions.push(`${missing.length} field reports missing (missing required data).`);
    } else if (lead.id === 'quoting_lead') {
      const quotes = await ctx.entities.QuoteRequests.list('-created_date', 100);
      const failed = quotes.filter(q => q.worker_status === 'failed').length;
      const needsSign = quotes.filter(q => q.worker_status === 'needs_sign_in').length;
      summary = `Reviewed ${quotes.length} quote requests: ${failed} failed, ${needsSign} need sign-in.`;
      if (failed > 0) exceptions.push(`${failed} quote requests failed (conflicting records or connector failure).`);
      if (needsSign > 0) exceptions.push(`${needsSign} quote requests need account sign-in (requires new external authorization).`);
    } else if (lead.id === 'development_lead') {
      const cal = await checkConnector('googlecalendar', ctx);
      const drive = await checkConnector('googledrive', ctx);
      const quotes = await ctx.entities.QuoteRequests.list('-created_date', 50);
      const failed = quotes.filter(q => q.worker_status === 'failed').length;
      summary = `Integration health: Google Calendar ${cal ? 'ok' : 'unavailable'}, Google Drive ${drive ? 'ok' : 'unavailable'}, ${failed} failed quote requests.`;
      if (!cal) exceptions.push('Google Calendar connector unavailable (connector failure).');
      if (!drive) exceptions.push('Google Drive connector unavailable (connector failure).');
    } else {
      summary = `Routine reconciliation completed for ${lead.name}.`;
    }
  } catch (e) {
    exceptions.push(`Could not reconcile internal status: ${e.message || e} (connector failure or data unavailable).`);
    if (!summary) summary = `Reconciliation incomplete for ${lead.name}.`;
  }
  return { summary, exceptions, connectorAvailable };
}

export async function getOrCreateConfig(ctx) {
  const rows = await ctx.entities.AgentOpsConfig.filter({ config_key: 'autonomous_ops' }, '-updated_date', 1);
  if (rows[0]) return rows[0];
  return await ctx.entities.AgentOpsConfig.create({
    config_key: 'autonomous_ops', autonomous_enabled: true, paused: false,
    lead_enablement: DEFAULT_ENABLEMENT, scheduled_time: '07:00',
  });
}

// Run the autonomous daily operations for one lead (onlyLeadId) or all enabled
// leads. Each lead reconciles internal status, records a run, and the Glass
// Forge manager combines summaries — escalating only true exceptions. No
// external messages, purchases, or payment actions are performed.
export async function executeDailyRuns(ctx, { triggeredBy = 'scheduler', onlyLeadId = null } = {}) {
  const config = await getOrCreateConfig(ctx);
  if (!config.autonomous_enabled) return { skipped: true, reason: 'Autonomous operations disabled.' };
  if (config.paused && triggeredBy === 'scheduler') return { skipped: true, reason: 'Autonomous operations paused.' };
  const runDate = new Date().toISOString().slice(0, 10);
  const leads = SECTION_LEADS.filter(l => onlyLeadId ? l.id === onlyLeadId : (config.lead_enablement && config.lead_enablement[l.id] !== false));
  const results = [];
  for (const lead of leads) {
    const run = await ctx.entities.AgentDailyRun.create({
      lead_id: lead.id, lead_name: lead.name, run_date: runDate,
      state: 'running', triggered_by: triggeredBy, started_at: new Date().toISOString(),
      summary: '', blockers: [], exceptions: [], plan_snapshot: lead.plan, escalated: false,
    });
    let result;
    try { result = await reconcileLead(lead, ctx); }
    catch (e) { result = { summary: `Reconciliation failed: ${e.message || e}`, exceptions: ['Connector failure or data unavailable prevented reconciliation.'] }; }
    const exceptions = result.exceptions || [];
    const state = exceptions.length > 0 ? 'blocked' : 'completed';
    const updated = await ctx.entities.AgentDailyRun.update(run.id, {
      state, summary: result.summary, blockers: exceptions, exceptions,
      completed_at: new Date().toISOString(),
    });
    results.push({ ...updated, lead });
  }
  let escalated = 0;
  for (const r of results) {
    if (r.state === 'blocked' && r.exceptions && r.exceptions.length > 0) {
      const esc = await ctx.entities.AgentCenterEscalation.create({
        escalation_key: 'daily_run:' + r.id,
        agent_id: r.lead_id, department: r.lead.department,
        title: 'Daily run exception: ' + r.lead_name,
        context: (r.summary || '') + '\n\nExceptions:\n- ' + r.exceptions.join('\n- '),
        status: 'needs_owner_decision', created_at: new Date().toISOString(),
      });
      await ctx.entities.AgentDailyRun.update(r.id, { escalated: true, escalation_id: esc.id });
      r.escalated = true; r.escalation_id = esc.id; escalated++;
    }
  }
  await ctx.entities.AgentOpsConfig.update(config.id, { last_run_at: new Date().toISOString() });
  return {
    ran: results.length,
    completed: results.filter(r => r.state === 'completed').length,
    blocked: results.filter(r => r.state === 'blocked').length,
    escalated,
    runs: results.map(r => ({ id: r.id, lead_id: r.lead_id, lead_name: r.lead_name, state: r.state, summary: r.summary, exceptions: r.exceptions, escalated: r.escalated, escalation_id: r.escalation_id, started_at: r.started_at, completed_at: r.completed_at, triggered_by: r.triggered_by })),
  };
}
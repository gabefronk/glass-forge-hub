import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { normalizeJobName, invoiceMonthFromDate } from '../../shared/ingestShared.ts';
import { sanitizeForInstaller } from '../../shared/sanitize.ts';

// Create or update an APP-authored event in BOTH Google calendars:
//   - full calendar (iryedra@gmail.com): everything incl. labor_amt
//   - installer calendar: sanitized, no labor_amt, no $ lines
// Stores both event ids on the CalendarEvents record, then upserts a FeeLine
// keyed on google_event_id using labor_amt directly (no description parsing).
// Never touches a google-sourced event.
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const FULL_CAL = 'iryedra@gmail.com';
const INSTALLER_CAL_ID = '9b5912fa9e6304d71fa5b1d00c830f5ddf6da4a685f23af44e281754ee8fca7d@group.calendar.google.com';

function addHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const h2 = (h + 1) % 24;
  return String(h2).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'manager') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const { id, job_id, event_date, start_time, job_name, builder, address, scope_notes, labor_amt, crew, prerequisites } = body;
    if (!event_date || !job_name) return Response.json({ error: 'missing_required' }, { status: 200 });

    const installerCal = INSTALLER_CAL_ID || secrets.get('INSTALLER_CALENDAR_ID');
    if (!installerCal) return Response.json({ error: 'installer_calendar_not_configured' }, { status: 200 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    const labor = Number(labor_amt) || 0;
    const fullDesc = [
      scope_notes || '',
      prerequisites || '',
      labor ? `Labor: $${labor.toLocaleString('en-US')}` : '',
    ].filter(Boolean).join('\n');

    const installerInput = [scope_notes || '', prerequisites || ''].join('\n');
    const { text: installerDesc, flagged } = sanitizeForInstaller(installerInput);

    const useTime = !!start_time && /^\d{2}:\d{2}$/.test(start_time);
    const start = useTime ? { dateTime: `${event_date}T${start_time}:00` } : { date: event_date };
    const end = useTime ? { dateTime: `${event_date}T${addHour(start_time)}:00` } : { date: event_date };

    const buildEvent = (description) => ({
      summary: job_name,
      description,
      start,
      end,
      extendedProperties: { private: { appSource: 'glassforge', laborAmt: String(labor) } },
    });

    let record = null;
    if (id) {
      try { record = await base44.asServiceRole.entities.CalendarEvents.get(id); } catch {}
    }
    const isAppUpdate = record && record.source === 'app' && record.google_event_id;

    let googleEventId, installerEventId;

    if (isAppUpdate) {
      const r1 = await fetch(`${CAL_API}/calendars/${encodeURIComponent(FULL_CAL)}/events/${record.google_event_id}`, {
        method: 'PUT', headers, body: JSON.stringify(buildEvent(fullDesc)),
      });
      if (!r1.ok) return Response.json({ error: 'full_update_failed', detail: await r1.text() }, { status: 200 });
      googleEventId = record.google_event_id;
      if (record.installer_event_id) {
        await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events/${record.installer_event_id}`, {
          method: 'PUT', headers, body: JSON.stringify(buildEvent(installerDesc)),
        });
        installerEventId = record.installer_event_id;
      } else {
        const r2 = await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events`, {
          method: 'POST', headers, body: JSON.stringify(buildEvent(installerDesc)),
        });
        const j2 = await r2.json();
        if (!r2.ok) return Response.json({ error: 'installer_create_failed', status: r2.status, detail: JSON.stringify(j2) }, { status: 200 });
        installerEventId = j2.id;
      }
    } else {
      const r1 = await fetch(`${CAL_API}/calendars/${encodeURIComponent(FULL_CAL)}/events`, {
        method: 'POST', headers, body: JSON.stringify(buildEvent(fullDesc)),
      });
      const j1 = await r1.json();
      if (!r1.ok) return Response.json({ error: 'full_create_failed', detail: JSON.stringify(j1) }, { status: 200 });
      googleEventId = j1.id;
      const r2 = await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events`, {
        method: 'POST', headers, body: JSON.stringify(buildEvent(installerDesc)),
      });
      const j2 = await r2.json();
      if (!r2.ok) return Response.json({ error: 'installer_create_failed', status: r2.status, detail: JSON.stringify(j2) }, { status: 200 });
      installerEventId = j2.id;
    }

    const recordData = {
      job_id: job_id || null,
      source: 'app',
      event_date,
      start_time: start_time || null,
      job_name,
      builder: builder || null,
      address: address || null,
      scope_notes: scope_notes || '',
      labor_amt: labor,
      crew: crew || null,
      prerequisites: prerequisites || null,
      google_event_id: googleEventId,
      installer_event_id: installerEventId,
      sanitize_flagged: flagged,
      created_by: record?.created_by || user.email || 'app',
    };

    if (isAppUpdate) {
      await base44.asServiceRole.entities.CalendarEvents.update(record.id, recordData);
      record = { ...record, ...recordData, id: record.id };
    } else {
      record = await base44.asServiceRole.entities.CalendarEvents.create(recordData);
    }

    // Feed FeeLines: upsert on calendar_event_id, written_by='app', labor_amt direct
    const feeRow = {
      job_id: job_id || null,
      job_date: event_date,
      invoice_month: invoiceMonthFromDate(event_date),
      job_name_raw: job_name,
      job_name_norm: normalizeJobName(job_name),
      line_description: (scope_notes || '').slice(0, 150),
      calendar_event_id: googleEventId,
      calendar_creator: user.email || null,
      calendar_organizer: null,
      calendar_labor_amt: labor,
      note_text: scope_notes || '',
      labor_amt: labor,
      fee_pct: 0.1,
      fee_amt: Number((labor * 0.1).toFixed(2)),
      billable: true,
      source: 'calendar',
      written_by: 'app',
      match_confidence: 'high',
      needs_review: false,
      manually_adjusted: false,
    };
    const existing = await base44.asServiceRole.entities.FeeLines.filter({ calendar_event_id: googleEventId }, '-created_date', 1);
    if (existing.length > 0) {
      const ex = existing[0];
      if (!ex.manually_adjusted) {
        await base44.asServiceRole.entities.FeeLines.update(ex.id, feeRow);
      }
    } else {
      await base44.asServiceRole.entities.FeeLines.create(feeRow);
    }

    return Response.json({
      ok: true,
      record,
      full_event_id: googleEventId,
      installer_event_id: installerEventId,
      installer_description: installerDesc,
      sanitize_flagged: flagged,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}
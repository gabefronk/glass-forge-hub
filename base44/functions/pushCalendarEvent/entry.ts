import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { normalizeJobName, invoiceMonthFromDate } from '../../shared/ingestShared.ts';
import { sanitizeForInstaller } from '../../shared/sanitize.ts';

// Idempotent create-or-update of an APP-authored event in BOTH Google calendars:
//   - full calendar (iryedra@gmail.com): everything incl. labor_amt
//   - installer calendar: sanitized, no labor_amt, no $ lines
//
// Idempotency rules:
//   - If the CalendarEvents record already has a google_event_id / installer_event_id,
//     UPDATE that event rather than creating a new one.
//   - If a stored event ID no longer exists in Google (404, deleted by hand),
//     recreate it and store the new ID.
//   - After each calendar push succeeds, persist the ID immediately so a later
//     failure never loses the progress already made. A retry then only pushes
//     the missing side — never re-pushes the one that worked.
//   - Never touches a google-sourced event (source !== 'app').
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const FULL_CAL = 'iryedra@gmail.com';
const INSTALLER_CAL_ID = '9b5912fa9e6304d71fa5b1d00c830f5ddf6da4a685f23af44e281754ee8fca7d@group.calendar.google.com';

function addHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const h2 = (h + 1) % 24;
  return String(h2).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Upsert a single calendar event. If existingId is present, try PUT (update);
// on 404 (deleted by hand) fall back to POST (recreate). Returns { id, error }.
async function upsertEvent(calId, existingId, eventBody, headers) {
  if (existingId) {
    const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(existingId)}`, {
      method: 'PUT', headers, body: JSON.stringify(eventBody),
    });
    if (r.ok) return { id: existingId };
    if (r.status === 404) {
      // Event was deleted by hand — fall through to create.
    } else {
      const detail = await r.text();
      return { error: 'update_failed', status: r.status, detail };
    }
  }
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events`, {
    method: 'POST', headers, body: JSON.stringify(eventBody),
  });
  const j = await r.json();
  if (!r.ok) return { error: 'create_failed', status: r.status, detail: JSON.stringify(j) };
  return { id: j.id };
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
    const { id, job_id, event_date, start_time, job_name, builder, address, scope_notes, labor_amt, crew, prerequisites, po_number, oe_number } = body;
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
    const { text: sanText, flagged } = sanitizeForInstaller(installerInput);
    // PO/OE as explicit structured lines — survive even if sanitizer drops the body
    const poOeLines = [po_number ? `PO: ${po_number}` : '', oe_number ? `OE: ${oe_number}` : ''].filter(Boolean).join('\n');
    const installerDesc = [poOeLines, sanText].filter(Boolean).join('\n');

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

    // Load existing record (if any). Only app-authored records are updatable.
    let record = null;
    if (id) {
      try { record = await base44.asServiceRole.entities.CalendarEvents.get(id); } catch {}
    }
    if (record && record.source !== 'app') {
      return Response.json({ error: 'cannot_edit_google_sourced' }, { status: 200 });
    }

    const baseRecordData = {
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
      sanitize_flagged: flagged,
      created_by: record?.created_by || user.email || 'app',
      po_number: po_number || null,
      oe_number: oe_number || null,
    };

    // --- STEP 1: FULL CALENDAR ---
    const fullResult = await upsertEvent(FULL_CAL, record?.google_event_id, buildEvent(fullDesc), headers);
    if (fullResult.error) {
      return Response.json({ error: `full_${fullResult.error}`, status: fullResult.status, detail: fullResult.detail, step: 'full' }, { status: 200 });
    }
    const googleEventId = fullResult.id;

    // Persist immediately so a later installer failure doesn't lose the full event ID.
    // (If the ID changed due to 404-recreate, this also saves the new ID.)
    if (record) {
      record = await base44.asServiceRole.entities.CalendarEvents.update(record.id, { ...baseRecordData, google_event_id: googleEventId });
    } else {
      record = await base44.asServiceRole.entities.CalendarEvents.create({ ...baseRecordData, google_event_id: googleEventId, installer_event_id: null });
    }

    // --- STEP 2: INSTALLER CALENDAR ---
    const installerResult = await upsertEvent(installerCal, record?.installer_event_id, buildEvent(installerDesc), headers);
    if (installerResult.error) {
      // Full event already persisted — retry will only push the installer side.
      return Response.json({ error: `installer_${installerResult.error}`, status: installerResult.status, detail: installerResult.detail, step: 'installer', record, full_event_id: googleEventId }, { status: 200 });
    }
    const installerEventId = installerResult.id;

    // Persist installer ID.
    record = await base44.asServiceRole.entities.CalendarEvents.update(record.id, { installer_event_id: installerEventId });

    // --- STEP 3: FEE LINES upsert (keyed on calendar_event_id) ---
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
      po_number: po_number || null,
      oe_number: oe_number || null,
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
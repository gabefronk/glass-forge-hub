// Shared installer-calendar push logic used by backfillInstallerCalendar and
// syncGoogleCalendarEvents. pushCalendarEvent has its own copy for app-
// authored events; this module handles google-sourced events.

import { sanitizeForInstaller } from './sanitize.ts';

const CAL_API = 'https://www.googleapis.com/calendar/v3';
const INSTALLER_CAL_ID = '9b5912fa9e6304d71fa5b1d00c830f5ddf6da4a685f23af44e281754ee8fca7d@group.calendar.google.com';

function addHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const h2 = (h + 1) % 24;
  return String(h2).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Build the installer event body: sanitized, no labor_amt, no organizer/creator,
// PO/OE prepended as structured lines so they survive even if the sanitizer
// drops the body. attendees: [] removes all guests (crew assignment comes later).
export function buildInstallerEvent(ev) {
  const { event_date, start_time, job_name, scope_notes, prerequisites, po_number, oe_number } = ev;
  const installerInput = [scope_notes || '', prerequisites || ''].join('\n');
  const { text: sanText } = sanitizeForInstaller(installerInput);
  const poOeLines = [po_number ? `PO: ${po_number}` : '', oe_number ? `OE: ${oe_number}` : ''].filter(Boolean).join('\n');
  const installerDesc = [poOeLines, sanText].filter(Boolean).join('\n');

  const useTime = !!start_time && /^\d{2}:\d{2}$/.test(start_time);
  const start = useTime ? { dateTime: `${event_date}T${start_time}:00`, timeZone: 'America/Denver' } : { date: event_date };
  const end = useTime ? { dateTime: `${event_date}T${addHour(start_time)}:00`, timeZone: 'America/Denver' } : { date: event_date };

  return {
    summary: job_name,
    description: installerDesc,
    start,
    end,
    attendees: [],
  };
}

// Upsert a single event to the installer calendar. If existingId is present,
// try PUT (update); on 404 (deleted by hand) fall back to POST (recreate).
// Returns { id } on success or { error, status?, detail? } on failure.
export async function upsertInstallerEvent(existingId, eventBody, headers) {
  const installerCal = INSTALLER_CAL_ID;
  if (!installerCal) return { error: 'installer_calendar_not_configured' };
  const fullHeaders = { ...headers, 'Content-Type': 'application/json' };

  if (existingId) {
    const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events/${encodeURIComponent(existingId)}?sendUpdates=none`, {
      method: 'PUT', headers: fullHeaders, body: JSON.stringify(eventBody),
    });
    if (r.ok) return { id: existingId };
    if (r.status === 404) {
      // Event was deleted by hand — fall through to create.
    } else {
      const detail = await r.text();
      return { error: 'update_failed', status: r.status, detail };
    }
  }
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events?sendUpdates=none`, {
    method: 'POST', headers: fullHeaders, body: JSON.stringify(eventBody),
  });
  const j = await r.json();
  if (!r.ok) return { error: 'create_failed', status: r.status, detail: JSON.stringify(j) };
  return { id: j.id };
}
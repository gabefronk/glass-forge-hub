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

// Add one day to a YYYY-MM-DD date string (for all-day exclusive end dates).
function addDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Build the installer event body: sanitized, no labor_amt, no organizer/creator,
// PO/OE prepended as structured lines so they survive even if the sanitizer
// drops the body. attendees: [] removes all guests (crew assignment comes later).
// Stores sourceGoogleEventId in extendedProperties for idempotent matching.
export function buildInstallerEvent(ev) {
  const { event_date, start_time, end_time, end_date, job_name, scope_notes, prerequisites, po_number, oe_number, source_location, address, google_event_id } = ev;
  const installerInput = [scope_notes || '', prerequisites || ''].join('\n');
  const { text: sanText } = sanitizeForInstaller(installerInput);
  const poOeLines = [po_number ? `PO: ${po_number}` : '', oe_number ? `OE: ${oe_number}` : ''].filter(Boolean).join('\n');
  const installerDesc = [poOeLines, sanText].filter(Boolean).join('\n');

  // Sanitize the location through the same rules as the description.
  const rawLocation = source_location || address || '';
  const { text: sanLocation } = sanitizeForInstaller(rawLocation);

  const useTime = !!start_time && /^\d{2}:\d{2}$/.test(start_time);
  const start = useTime
    ? { dateTime: `${event_date}T${start_time}:00`, timeZone: 'America/Denver' }
    : { date: event_date };

  let end;
  if (useTime) {
    // Timed event: copy source end_time exactly (fallback +1h if missing).
    const endTime = (end_time && /^\d{2}:\d{2}$/.test(end_time)) ? end_time : addHour(start_time);
    // End times at/before the start belong to the following day, including the
    // +1h fallback from 23:xx. Preserve the source clock time and Denver zone.
    const timedEndDate = endTime <= start_time ? addDay(event_date) : event_date;
    end = { dateTime: `${timedEndDate}T${endTime}:00`, timeZone: 'America/Denver' };
  } else {
    // All-day: Google treats end.date as EXCLUSIVE. Use stored end_date or start + 1 day.
    end = { date: end_date || addDay(event_date) };
  }

  const body = {
    summary: job_name,
    description: installerDesc,
    start,
    end,
    attendees: [],
  };

  // Only set location if sanitization left it non-empty.
  if (sanLocation) body.location = sanLocation;

  // Store source Google event ID for idempotent matching on re-runs.
  if (google_event_id) {
    body.extendedProperties = {
      private: { sourceGoogleEventId: google_event_id }
    };
  }

  return body;
}

// Fetch all events from the installer calendar and build a map of
// sourceGoogleEventId → installer event ID. Used for idempotent matching
// when a CalendarEvents row has no stored installer_event_id.
export async function fetchInstallerEventMap(headers) {
  const baseUrl = `${CAL_API}/calendars/${encodeURIComponent(INSTALLER_CAL_ID)}/events?maxResults=2500&singleEvents=true`;
  const map = new Map();
  const visitedTokens = new Set();
  let pageToken = null;
  for (let page = 0; page < 50; page++) {
    const url = baseUrl + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers });
    // Missing identity lookup is not an empty calendar. Fail before callers
    // can create a duplicate installer event based on incomplete evidence.
    if (!res.ok) throw new Error(`Installer calendar lookup failed (HTTP ${res.status}).`);
    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error || (data.items !== undefined && !Array.isArray(data.items))) {
      throw new Error('Installer calendar lookup returned an invalid page.');
    }
    for (const ev of data.items || []) {
      if (!ev || typeof ev !== 'object') throw new Error('Installer calendar lookup returned an invalid event.');
      const sid = ev.extendedProperties?.private?.sourceGoogleEventId;
      if (sid) {
        if (typeof sid !== 'string' || typeof ev.id !== 'string' || !ev.id) throw new Error('Installer calendar lookup returned an invalid event identity.');
        map.set(sid, ev.id);
      }
    }
    if (data.nextPageToken == null || data.nextPageToken === '') return map;
    if (typeof data.nextPageToken !== 'string' || visitedTokens.has(data.nextPageToken)) {
      throw new Error('Installer calendar lookup returned an invalid or repeated page token.');
    }
    visitedTokens.add(data.nextPageToken);
    pageToken = data.nextPageToken;
  }
  throw new Error('Installer calendar lookup exceeded 50 pages; completeness is not verified.');
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

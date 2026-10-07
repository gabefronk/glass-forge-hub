// Pure Google Calendar transport factory. No Base44 SDK and no global fetch
// imported — getToken and fetch are injected. The production entry wires the real
// connector token (server-side) and the real fetch; tests inject mocks. This is
// the EXACT adapter the production entry uses; tests exercise it with mock
// fetch/connector (the adapter under test is never mocked away).
//
// Network-unknown semantics: a non-OK status, malformed body, or throw is never
// fabricated as success — listEvents returns { items, error }, getEvent/insertEvent
// map anything unexpected to the core's unknown outcomes. No retry POST unless a
// GET proves the event is missing.
import * as core from './jobCalendarCore.js';

export function createGoogleTransport({ getToken, fetch, calendar, apiUrl = 'https://www.googleapis.com/calendar/v3' }) {
  const CAL = calendar;
  const eventsUrl = `${apiUrl}/calendars/${encodeURIComponent(CAL)}/events`;
  const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

  async function listEvents(timeMin, timeMax) {
    let token;
    try { token = await getToken(); } catch { return { items: [], error: { kind: 'not_connected' } }; }
    if (!token) return { items: [], error: { kind: 'not_connected' } };
    const base = `${eventsUrl}?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
    const fetchPage = async (pageToken) => {
      const res = await fetch(base + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), { headers: authHeaders(token) });
      return { ok: res.ok, status: res.status, json: () => res.json() };
    };
    return core.paginateGoogleEvents(fetchPage);
  }

  async function getEvent(id) {
    let token;
    try { token = await getToken(); } catch { return { kind: 'unknown' }; }
    if (!token) return { kind: 'unknown' };
    let res;
    try { res = await fetch(`${eventsUrl}/${encodeURIComponent(id)}`, { headers: authHeaders(token) }); }
    catch { return { kind: 'unknown' }; }
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'unknown' };
    let ev;
    try { ev = await res.json(); } catch { return { kind: 'unknown' }; }
    if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || ev.id !== id) return { kind: 'unknown' };
    return { kind: 'found', event: ev };
  }

  async function insertEvent(body) {
    let token;
    try { token = await getToken(); } catch { return { ok: false, status: 0, unknown: true }; }
    if (!token) return { ok: false, status: 0, unknown: true };
    let res;
    try { res = await fetch(`${eventsUrl}?sendUpdates=none`, { method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { return { ok: false, status: 0, unknown: true }; }
    if (res.status === 409) return { ok: false, status: 409 };
    if (!res.ok) return { ok: false, status: res.status, unknown: true };
    let ev;
    try { ev = await res.json(); } catch { return { ok: false, status: res.status, unknown: true }; }
    if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string') return { ok: false, status: res.status, unknown: true };
    return { ok: true, status: res.status, event: ev };
  }

  return { listEvents, getEvent, insertEvent };
}
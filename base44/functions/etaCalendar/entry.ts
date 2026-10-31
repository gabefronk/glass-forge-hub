import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { isPurchasingMoneyOwner } from '../../shared/purchasingMoneyPure.js';
import {
  etaEventBody, etaCalendarId, isEtaCalendarChoice, linkEventIds, planEtaCalendars, DEFAULT_ETA_CALENDAR,
} from '../../shared/etaCalendarEvent.js';

// Ties a supplier ETA to real Google Calendar events on the crew calendars the
// owner picked with it (Israel's, Milan's, or both), so the events MOVE when the
// ETA moves and disappear when the ETA is cleared. One link row per ETA source (a
// vendor order or a job budget), keyed on eta_key, holds the Google event id per
// calendar and the calendar choice.
//
// The event title is the job's name, exactly as the Jobs tab titles its visits;
// the job site is the event location; a will-call order (VendorOrders
// delivery_method) says so in the body. Pure pieces: base44/shared/etaCalendarEvent.js.
//
// Boundaries: this function only touches those calendar events and their link row.
// It never writes CalendarEvents (the Hub's own mirror table), never creates a
// FeeLine, never messages anyone, and never changes an order, PO or budget - the
// Hub record of the ETA stays the source of truth.
//
// The pushed event carries extendedProperties appSource 'glassforge', which is
// what the Hub's own Google pull (syncGoogleCalendarEvents) skips: the ETA is
// already shown from the purchasing records, and it must not become a
// report-required visit. hubJobId (and the Hub job link in the body) tie it to the job.
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ETA_KEY = /^(order|budget):[A-Za-z0-9]+$/;

// Create-or-update. A stored id that Google no longer has (deleted by hand) is
// recreated instead of failing.
async function upsertEvent(calId, existingId, event, headers) {
  if (existingId) {
    const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(existingId)}`, {
      method: 'PUT', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { id: existingId };
    if (res.status !== 404 && res.status !== 410) {
      const detail = (await res.text()).slice(0, 400);
      return { error: 'event_update_failed', status: res.status, detail };
    }
  }
  const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events`, {
    method: 'POST', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    return { error: 'event_create_failed', status: res.status, detail };
  }
  const created = await res.json();
  return { id: created.id };
}

async function removeEvent(calId, eventId, headers) {
  const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE', headers, signal: AbortSignal.timeout(15000),
  });
  return res.ok || res.status === 404 || res.status === 410;
}

// Takes the given calendars' events off, keeping the ids of any that could not be removed.
async function removeFrom(keys, ids, headers) {
  const left = { ...ids };
  for (const key of keys) {
    const calId = etaCalendarId(key);
    if (calId && await removeEvent(calId, left[key], headers).catch(() => false)) delete left[key];
  }
  return left;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(user.role === 'admin' || user.role === 'manager' || isPurchasingMoneyOwner(user))) {
      return Response.json({ error: 'Only the owner can move a delivery ETA on the calendar.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const etaKey = String(body.eta_key || '').trim();
    const date = String(body.date || '').trim();
    const jobId = String(body.job_id || '').trim();
    const asked = String(body.calendars || '').trim();
    if (!ETA_KEY.test(etaKey)) return Response.json({ error: 'missing_eta_key' }, { status: 200 });
    if (date && !ISO_DAY.test(date)) return Response.json({ error: 'invalid_eta_date' }, { status: 200 });
    if (asked && !isEtaCalendarChoice(asked)) return Response.json({ error: 'invalid_calendar_choice' }, { status: 200 });

    const entities = base44.asServiceRole.entities;
    const job = jobId ? await entities.Jobs.get(jobId).catch(() => null) : null;
    const links = await entities.EtaCalendarLinks.filter({ eta_key: etaKey }).catch(() => []);
    const link = (links || [])[0] || null;
    const ids = linkEventIds(link);
    const choice = asked || (isEtaCalendarChoice(link?.calendar_choice) ? link.calendar_choice : DEFAULT_ETA_CALENDAR);

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    if (!accessToken) return Response.json({ error: 'calendar_not_connected' }, { status: 200 });
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    // ETA cleared: the calendar events go with it, so nothing stale is left behind.
    if (!date) {
      const left = await removeFrom(Object.keys(ids), ids, headers);
      if (!link) return Response.json({ ok: true, cleared: true, eta_key: etaKey });
      if (!Object.keys(left).length) {
        await entities.EtaCalendarLinks.delete(link.id).catch(() => {});
        return Response.json({ ok: true, cleared: true, eta_key: etaKey });
      }
      await entities.EtaCalendarLinks.update(link.id, { google_event_ids: left, google_event_id: left.israel || Object.values(left)[0] || '', updated_at: new Date().toISOString() });
      return Response.json({ error: 'event_remove_failed', calendars: Object.keys(left) }, { status: 200 });
    }

    // A supplier order is the record of will call vs delivery; read it, never trust the caller.
    const order = etaKey.startsWith('order:') ? await entities.VendorOrders.get(etaKey.slice(6)).catch(() => null) : null;
    const event = etaEventBody(job, {
      date, etaKey,
      ref: order?.order_number || body.ref || '',
      vendor: order?.vendor || body.vendor || '',
      deliveryMethod: order?.delivery_method || '',
    });

    const { keep, remove } = planEtaCalendars(choice, ids);
    let next = { ...ids };
    let failed = null;
    for (const key of keep) {
      const pushed = await upsertEvent(etaCalendarId(key), next[key], event, headers);
      if (pushed.error) { failed = failed || { ...pushed, calendar: key }; continue; }
      next[key] = pushed.id;
    }
    // Calendars no longer picked lose the event, but only once the new ones have it.
    if (!failed) next = await removeFrom(remove, next, headers);

    if (Object.keys(next).length || link) {
      const row = {
        eta_key: etaKey,
        job_id: jobId || link?.job_id || '',
        calendar_choice: choice,
        google_event_ids: next,
        google_event_id: next.israel || Object.values(next)[0] || '',
        event_date: date,
        summary: event.summary,
        updated_at: new Date().toISOString(),
      };
      if (link) await entities.EtaCalendarLinks.update(link.id, row);
      else await entities.EtaCalendarLinks.create(row);
    }
    if (failed) {
      return Response.json({ error: failed.error, calendar: failed.calendar, status: failed.status, detail: failed.detail }, { status: 200 });
    }

    return Response.json({
      ok: true,
      calendar_choice: choice,
      calendars: Object.fromEntries(keep.map((k) => [k, { calendar_id: etaCalendarId(k), google_event_id: next[k] }])),
      event_date: date,
      summary: event.summary,
      location: event.location,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

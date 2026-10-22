import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { isPurchasingMoneyOwner } from '../../shared/purchasingMoneyPure.js';

// Ties a supplier ETA to a real Google Calendar event on Israel's own calendar
// (iryedra@gmail.com), so the event MOVES when the ETA moves and disappears when
// the ETA is cleared. One link row per ETA source (a vendor order or a job
// budget), keyed on eta_key, holds the Google event id.
//
// Boundaries: this function only touches that calendar event and its link row.
// It never writes CalendarEvents (the Hub's own mirror table), never creates a
// FeeLine, never messages anyone, and never changes an order, PO or budget - the
// Hub record of the ETA stays the source of truth.
//
// The pushed event carries extendedProperties appSource 'glassforge', which is
// what the Hub's own Google pull (syncGoogleCalendarEvents) skips: the ETA is
// already shown from the purchasing records, and it must not become a
// report-required visit.
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const ISRAEL_CAL = 'iryedra@gmail.com';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ETA_KEY = /^(order|budget):[A-Za-z0-9]+$/;
const DAY_MS = 86400000;

const dayAfter = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

function eventBody(job, { date, etaKey, ref, vendor, summary }) {
  const description = [
    `Job: ${job?.canonical_name || 'Not linked'}`,
    job?.builder ? `Builder: ${job.builder}` : '',
    job?.address ? `Site: ${job.address}` : '',
    vendor ? `Supplier: ${vendor}` : '',
    ref ? `Reference: ${ref}` : '',
    'Glass delivery ETA from Glass Forge Hub. This event moves with the ETA.',
  ].filter(Boolean).join('\n');
  return {
    summary,
    description,
    // All-day, single day: Google's end date is exclusive.
    start: { date },
    end: { date: dayAfter(date) },
    extendedProperties: { private: { appSource: 'glassforge', hubEtaKey: etaKey, hubJobId: job?.id || '' } },
  };
}

// Create-or-update. A stored id that Google no longer has (deleted by hand) is
// recreated instead of failing.
async function upsertEvent(calId, existingId, event, headers) {
  if (existingId) {
    const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(existingId)}`, {
      method: 'PUT', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { id: existingId };
    if (res.status !== 404) {
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
    if (!ETA_KEY.test(etaKey)) return Response.json({ error: 'missing_eta_key' }, { status: 200 });
    if (date && !ISO_DAY.test(date)) return Response.json({ error: 'invalid_eta_date' }, { status: 200 });

    const entities = base44.asServiceRole.entities;
    const job = jobId ? await entities.Jobs.get(jobId).catch(() => null) : null;
    const links = await entities.EtaCalendarLinks.filter({ eta_key: etaKey }).catch(() => []);
    const link = (links || [])[0] || null;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    if (!accessToken) return Response.json({ error: 'calendar_not_connected' }, { status: 200 });
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    // ETA cleared: the calendar event goes with it, so nothing stale is left behind.
    if (!date) {
      if (link?.google_event_id) await removeEvent(ISRAEL_CAL, link.google_event_id, headers);
      if (link) await entities.EtaCalendarLinks.delete(link.id).catch(() => {});
      return Response.json({ ok: true, cleared: true, eta_key: etaKey });
    }

    // Matches the ETA events already on Israel's calendar: "ETA - <builder> - <job>".
    // The supplier reference stays in the description, so the title stays scannable.
    const summary = ['ETA', job?.builder, job?.canonical_name || 'Glass job'].filter(Boolean).join(' - ');
    const pushed = await upsertEvent(ISRAEL_CAL, link?.google_event_id, eventBody(job, { date, etaKey, ref: body.ref, vendor: body.vendor, summary }), headers);
    if (pushed.error) {
      return Response.json({ error: pushed.error, status: pushed.status, detail: pushed.detail }, { status: 200 });
    }

    const row = {
      eta_key: etaKey,
      job_id: jobId || link?.job_id || '',
      google_event_id: pushed.id,
      event_date: date,
      summary,
      updated_at: new Date().toISOString(),
    };
    const saved = link
      ? await entities.EtaCalendarLinks.update(link.id, row)
      : await entities.EtaCalendarLinks.create(row);

    return Response.json({
      ok: true,
      calendar_id: ISRAEL_CAL,
      google_event_id: pushed.id,
      event_date: date,
      summary,
      link_id: saved?.id || link?.id || '',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
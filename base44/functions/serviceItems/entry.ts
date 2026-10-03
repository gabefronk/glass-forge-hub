import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

// Service items: the red banner on a job. One record per thing that needs fixing.
// Actions (POST JSON):
//   open     — from an incomplete field report (job_id, service_type, unit, description, photos,
//              source_note_id, source_event_id, request_key). Notifies the owner (Milan):
//              email + text (email-to-SMS) + one to-do. Deduped by request_key. If the report
//              was filed against an open item's own service visit, it is logged on that item
//              instead of opening a second one.
//   update   — { id, status?, note?, eta_date?, tracking?, supplier?, order_ref?, cause?,
//              cost_owner?, service_date?, owner_member_key? }. Any change stamps
//              last_activity_at and resets the ping clock. Rules:
//                ordered / shipped  → ETA required
//                delivered          → auto-drafts the service visit (Google + installer calendar
//                                     via pushCalendarEvent) on the next business day
//                scheduled          → service date required; confirms / moves the visit
//                fixed              → the service visit's field report must be marked complete
//                closed             → closing note required
//   (resolveFieldReport stamps service_report_complete_at when the service visit's report is
//   filed complete.)
//   ping     — daily 07:00 Denver workflow (no user). Every open item quiet since yesterday, or
//              ordered/shipped past its ETA → email + text the owner; Gabe is copied once it
//              has been quiet 2+ days.
//   list     — { job_id? | job_ids?[], open_only? } for the Jobs list / banner.

const OPEN = ['reported', 'acknowledged', 'working', 'ordered', 'shipped', 'delivered', 'scheduled', 'on_hold'];
const LABELS = {
  reported: 'Reported', acknowledged: 'Acknowledged', working: 'Being worked on', ordered: 'Ordered',
  shipped: 'Shipped', delivered: 'Delivered', scheduled: 'Service scheduled', fixed: 'Fixed',
  closed: 'Closed', on_hold: 'On hold', cancelled: 'Cancelled',
};
const TYPES = {
  wrong_size: 'Wrong size', damaged: 'Damaged / broken', missing_unit: 'Missing or lost unit',
  missing_part: 'Missing part / hardware', install_defect: 'Install defect', other: 'Action needed',
};
const APP_URL = 'https://glass-forge-hub.base44.app';
// Texts go out as iMessages through Gabe's BlueBubbles server on the Mac (Cloudflare tunnel).
// Needs the BLUEBUBBLES_PASSWORD secret. Only ever texts the service owner / escalation
// numbers from AppSettings — this is team notification, not customer messaging.
const BB_URL = 'https://bluebubbles.gfglassforge.com';
const secret = (name) => { try { return secrets.get(name) || Deno.env.get(name) || ''; } catch { try { return Deno.env.get(name) || ''; } catch { return ''; } } };
const e164 = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d ? `+${d}` : '';
};

const denverDate = (v = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const nextBusinessDay = (day) => {
  const d = new Date(day + 'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
};
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function contactsFor(api, memberKey) {
  // Owner contact: AppSettings.service_owner_email / service_owner_sms (email-to-text address),
  // falling back to the TeamMember's login email. Escalation: AppSettings.service_escalate_email.
  const settings = (await api.AppSettings.list('-created_date', 1, 0).catch(() => []))[0] || {};
  const out = { email: settings.service_owner_email || '', phone: settings.service_owner_phone || '', sms: settings.service_owner_sms || '', escalate: settings.service_escalate_email || '', memberId: '', memberKey: memberKey || '' };
  const members = await api.TeamMember.list('id', 100, 0).catch(() => []);
  const member = (memberKey && members.find((m) => m.member_key === memberKey)) || members.find((m) => /^milan/i.test(String(m.display_name || '')));
  if (member) {
    out.memberId = member.id;
    out.memberKey = member.member_key;
    if (!out.email && member.auth_user_ids?.length) {
      const users = await api.User.list('id', 200, 0).catch(() => []);
      const u = users.find((x) => member.auth_user_ids.includes(x.id));
      if (u?.email) out.email = u.email;
    }
  }
  return out;
}

// --- Sending: Gmail connector first (reaches any address, incl. carrier email-to-text gateways),
// Core.SendEmail as the fallback.
const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
async function gmailSend(base44, to, subject, body) {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
  const mime = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body),
  ].join('\r\n');
  const raw = b64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`gmail_${r.status}`);
}
async function sendOne(base44, to, subject, body) {
  try { await gmailSend(base44, to, subject, body); return 'gmail'; } catch (_) { /* fall through */ }
  try { await base44.asServiceRole.integrations.Core.SendEmail({ to, subject, body }); return 'core'; } catch (_) { return ''; }
}
async function bb(path, payload) {
  const pw = secret('BLUEBUBBLES_PASSWORD');
  if (!pw) throw new Error('no_bluebubbles_password');
  const r = await fetch(`${BB_URL}${path}?password=${encodeURIComponent(pw)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`bluebubbles_${r.status}`);
  return r.json().catch(() => ({}));
}
// iMessage through BlueBubbles: the existing 1:1 chat first, then start one if there isn't one.
async function imessage(phone, text) {
  const to = e164(phone);
  if (!to) return '';
  try {
    await bb('/api/v1/message/text', { chatGuid: `iMessage;-;${to}`, tempGuid: `svc-${crypto.randomUUID()}`, message: text, method: 'apple-script' });
    return 'imessage';
  } catch (e) {
    if (String(e?.message) === 'no_bluebubbles_password') { console.log('serviceItems: BLUEBUBBLES_PASSWORD not set, text skipped'); return ''; }
    try {
      await bb('/api/v1/chat/new', { addresses: [to], message: text, service: 'iMessage', method: 'apple-script', tempGuid: `svc-${crypto.randomUUID()}` });
      return 'imessage-new';
    } catch (e2) { console.log(`serviceItems: text to ${to} failed: ${e2?.message || e2}`); return ''; }
  }
}

// emails: full message. phones: iMessage via BlueBubbles. sms: carrier email-to-text address,
// used only when the iMessage didn't go.
async function notify(base44, { emails = [], phones = [], sms = [] }, subject, body, text) {
  const sent = [];
  for (const addr of [...new Set(emails.filter(Boolean))]) if (await sendOne(base44, addr, subject, body)) sent.push(addr);
  let texted = false;
  for (const p of [...new Set(phones.filter(Boolean))]) if (await imessage(p, text)) { sent.push(e164(p)); texted = true; }
  if (!texted) for (const addr of [...new Set(sms.filter(Boolean))]) if (await sendOne(base44, addr, 'Service item', text)) sent.push(addr);
  return sent;
}

const jobLink = (item) => `${APP_URL}/jobs/${item.job_id}`;
function summary(item) {
  return [
    `Job: ${item.job_name || item.job_id}`,
    `Issue: ${TYPES[item.service_type] || 'Action needed'}${item.unit ? ` — ${item.unit}` : ''}`,
    `Status: ${LABELS[item.status] || item.status}`,
    item.eta_date ? `ETA: ${item.eta_date}` : '',
    item.service_date ? `Service visit: ${item.service_date}` : '',
    `Note: ${item.description || '(none)'}`,
    `Open job: ${jobLink(item)}`,
  ].filter(Boolean).join('\n');
}
const smsText = (item, lead) => `${lead}: ${item.job_name || 'job'} - ${TYPES[item.service_type] || 'Action needed'}${item.unit ? ` (${item.unit})` : ''}. ${LABELS[item.status] || item.status}. ${jobLink(item)}`.slice(0, 300);

async function pushServiceVisit(base44, api, item, day, confirmed) {
  const job = await api.Jobs.get(item.job_id).catch(() => null);
  const what = `${TYPES[item.service_type] || 'Action needed'}${item.unit ? ` — ${item.unit}` : ''}`;
  const payload = {
    id: item.service_event_id || undefined,
    job_id: item.job_id,
    event_date: day,
    job_name: `${confirmed ? 'SERVICE' : 'SERVICE (DRAFT)'} — ${item.job_name || job?.canonical_name || 'job'}`,
    builder: job?.builder || '',
    address: job?.address || '',
    scope_notes: [`Service item: ${what}`, item.description || '', item.order_ref ? `Order: ${item.order_ref}` : '', confirmed ? '' : 'Draft date — confirm with the PM before going out.'].filter(Boolean).join('\n'),
    labor_amt: 0,
  };
  const res = await base44.functions.invoke('pushCalendarEvent', payload).catch((e) => ({ data: { error: e?.message || 'push_failed' } }));
  const data = res?.data || {};
  if (data.error && !data.record?.id) return { error: data.error };
  return { eventId: data.record?.id || item.service_event_id || '', partial: data.error || '' };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    const api = base44.asServiceRole.entities;
    const now = new Date().toISOString();

    // The daily workflow calls ping with no user. A logged-in caller must be an admin for ping;
    // everything else needs a login.
    const user = await base44.auth.me().catch(() => null);
    if (action === 'ping') {
      if (user && user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
    } else if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const who = user?.email || 'system';

    if (action === 'list') {
      const ids = Array.isArray(body.job_ids) ? body.job_ids.filter(Boolean) : (body.job_id ? [body.job_id] : []);
      const filter = {};
      if (ids.length === 1) filter.job_id = ids[0];
      else if (ids.length > 1) filter.job_id = { $in: ids };
      if (body.open_only) filter.status = { $in: OPEN };
      const items = await api.ServiceItems.filter(filter, '-created_date', 500, 0);
      return Response.json({ ok: true, items });
    }

    if (action === 'open') {
      const { job_id, service_type, description, unit, photos, source_note_id, source_event_id, request_key } = body;
      if (!job_id) return Response.json({ error: 'missing_job' }, { status: 200 });
      if (request_key) {
        const dup = await api.ServiceItems.filter({ request_key }, 'id', 1, 0);
        if (dup.length) return Response.json({ ok: true, item: dup[0], deduped: true });
      }
      // An incomplete report on an item's own service visit goes back on that item.
      if (source_event_id) {
        const same = (await api.ServiceItems.filter({ service_event_id: source_event_id }, '-created_date', 5, 0)).find((i) => OPEN.includes(i.status));
        if (same) {
          const log = [...(same.activity_log || []), { at: now, by: who, action: 'service visit — not finished', note: description || '' }];
          const item = await api.ServiceItems.update(same.id, {
            status: 'working', activity_log: log, last_activity_at: now, ping_count: 0,
            service_report_complete_at: '', photos: [...(same.photos || []), ...(photos || [])],
          });
          return Response.json({ ok: true, item, reopened: true });
        }
      }
      const job = await api.Jobs.get(job_id).catch(() => null);
      const contacts = await contactsFor(api, '');
      const item = await api.ServiceItems.create({
        job_id,
        job_name: job?.canonical_name || '',
        source_note_id: source_note_id || '',
        source_event_id: source_event_id || '',
        service_type: TYPES[service_type] ? service_type : 'other',
        description: description || '',
        unit: unit || '',
        photos: photos || [],
        status: 'reported',
        owner_member_key: contacts.memberKey || 'milan',
        escalate_to_email: contacts.escalate || '',
        last_activity_at: now,
        ping_count: 0,
        activity_log: [{ at: now, by: who, action: 'reported', note: description || '' }],
        request_key: request_key || '',
        created_by_email: who,
      });

      // The owner's one to-do for this issue (resolveFieldReport no longer adds its own).
      if (contacts.memberId) {
        const key = `service-item:${item.id}`;
        const existing = await api.TodoTask.filter({ request_key: key }, 'id', 1, 0);
        if (!existing.length) {
          await api.TodoTask.create({
            title: `Service item — ${item.job_name || 'job'}: ${TYPES[item.service_type]}${item.unit ? ` (${item.unit})` : ''}`,
            details: summary(item),
            assignee_member_id: contacts.memberId,
            status: 'open', progress_note: '', due_date: '', category: 'follow_up',
            created_by_user_id: user.id, assigned_by_user_id: user.id,
            completed_at: '', completed_by_user_id: '', archived_at: '', revision: 0,
            request_key: key, seed_key: '', created_at: now, updated_at: now,
          });
        }
      }
      const subject = `SERVICE ITEM — ${item.job_name || 'job'}: ${TYPES[item.service_type]}${item.unit ? ` (${item.unit})` : ''}`;
      const sent = await notify(base44, { emails: [contacts.email], phones: [contacts.phone], sms: [contacts.sms] }, subject, summary(item), smsText(item, 'NEW SERVICE ITEM'));
      return Response.json({ ok: true, item, notified: sent });
    }

    if (action === 'update') {
      const { id } = body;
      if (!id) return Response.json({ error: 'missing_params' }, { status: 200 });
      const item = await api.ServiceItems.get(id).catch(() => null);
      if (!item) return Response.json({ error: 'not_found' }, { status: 200 });
      const patch = {};
      for (const k of ['status', 'eta_date', 'tracking', 'supplier', 'order_ref', 'cause', 'cost_owner', 'service_date', 'owner_member_key', 'unit', 'description']) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const next = patch.status || item.status;
      if (patch.status && !LABELS[patch.status]) return Response.json({ error: 'bad_status' }, { status: 200 });
      if (patch.status && ['closed', 'fixed', 'cancelled'].includes(item.status) && OPEN.includes(patch.status)) {
        // Reopening is allowed; it just goes back on the banner.
        patch.closed_at = ''; patch.closed_by = '';
      }
      if ((next === 'ordered' || next === 'shipped') && !(patch.eta_date || item.eta_date)) {
        return Response.json({ error: 'eta_required' }, { status: 200 });
      }
      if (patch.status === 'scheduled' && !isDay(patch.service_date || item.service_date)) {
        return Response.json({ error: 'service_date_required' }, { status: 200 });
      }
      if (patch.status === 'fixed') {
        // The service visit's field report must say "complete". Accept the stamped visit report,
        // or a complete report filed on the job on the service date.
        let ok = Boolean(item.service_report_complete_at);
        if (!ok && isDay(item.service_date)) {
          const notes = await api.JobNotes.filter({ job_id: item.job_id, note_date: item.service_date }, '-created_date', 20, 0).catch(() => []);
          ok = notes.some((n) => n.completion === 'complete');
        }
        if (!ok) return Response.json({ error: 'service_report_required' }, { status: 200 });
      }
      if (patch.status === 'closed' && !String(body.note || '').trim()) {
        return Response.json({ error: 'note_required' }, { status: 200 });
      }
      if (patch.status === 'closed' || patch.status === 'fixed' || patch.status === 'cancelled') {
        patch.closed_at = now; patch.closed_by = who;
      }

      const entry = { at: now, by: who, action: patch.status && patch.status !== item.status ? `status → ${LABELS[patch.status]}` : 'note', note: String(body.note || '').trim() };
      const extra = [];
      if (patch.eta_date && patch.eta_date !== item.eta_date) extra.push(`ETA ${patch.eta_date}`);
      if (patch.service_date && patch.service_date !== item.service_date) extra.push(`service visit ${patch.service_date}`);
      if (extra.length) entry.note = [entry.note, ...extra].filter(Boolean).join(' · ');
      const log = [...(item.activity_log || []), entry];

      // Calendar: Delivered drafts the service visit; Service scheduled (or a new date on an
      // existing visit) confirms / moves it. Both go through pushCalendarEvent so the full and
      // the sanitized installer calendars stay in step.
      let calendarNote = '';
      const wantsDraft = patch.status === 'delivered' && !item.service_event_id;
      const dateChanged = patch.service_date && patch.service_date !== item.service_date;
      const confirming = next === 'scheduled' && (patch.status === 'scheduled' || dateChanged);
      if (wantsDraft || confirming || (dateChanged && item.service_event_id)) {
        const day = isDay(patch.service_date) ? patch.service_date : (isDay(item.service_date) && !wantsDraft ? item.service_date : nextBusinessDay(denverDate()));
        const pushed = await pushServiceVisit(base44, api, { ...item, ...patch }, day, confirming);
        if (pushed.error) {
          calendarNote = `calendar not updated (${pushed.error})`;
        } else {
          patch.service_event_id = pushed.eventId;
          patch.service_date = day;
          patch.service_event_draft = !confirming;
          calendarNote = `${confirming ? 'service visit on calendar' : 'draft service visit'} ${day}${pushed.partial ? ` (installer calendar: ${pushed.partial})` : ''}`;
        }
        log.push({ at: now, by: who, action: 'calendar', note: calendarNote });
      }

      patch.activity_log = log;
      patch.last_activity_at = now;
      patch.ping_count = 0;
      const updated = await api.ServiceItems.update(id, patch);

      // Close out the owner's to-do when the item is done.
      if (['closed', 'cancelled', 'fixed'].includes(patch.status)) {
        const todos = await api.TodoTask.filter({ request_key: `service-item:${id}` }, 'id', 1, 0).catch(() => []);
        for (const t of todos) if (t.status !== 'done') await api.TodoTask.update(t.id, { status: 'done', completed_at: now, completed_by_user_id: user.id, updated_at: now }).catch(() => {});
      }
      // Reorders cost money: copy Gabe when it is ordered.
      if (patch.status === 'ordered' && item.status !== 'ordered') {
        const contacts = await contactsFor(api, updated.owner_member_key);
        const esc = contacts.escalate || updated.escalate_to_email;
        if (esc) await notify(base44, { emails: [esc] }, `Reorder placed — ${updated.job_name}: ${TYPES[updated.service_type]}`, summary(updated), '');
      }
      return Response.json({ ok: true, item: updated, calendar: calendarNote || undefined });
    }

    if (action === 'ping') {
      const today = denverDate();
      const items = await api.ServiceItems.filter({ status: { $in: OPEN } }, '-created_date', 500, 0);
      const settingsContacts = await contactsFor(api, '');
      const results = [];
      for (const item of items) {
        if (item.status === 'on_hold') continue;
        if (item.last_ping_at && denverDate(item.last_ping_at) === today) continue; // once a day
        const lastDay = denverDate(item.last_activity_at || item.created_date);
        const quiet = Math.max(0, daysBetween(lastDay, today)); // 1 = nothing since yesterday
        const etaPassed = isDay(item.eta_date) && item.eta_date < today && ['ordered', 'shipped'].includes(item.status);
        if (quiet < 1 && !etaPassed) continue;
        const contacts = item.owner_member_key && item.owner_member_key !== settingsContacts.memberKey ? await contactsFor(api, item.owner_member_key) : settingsContacts;
        const emails = [contacts.email];
        const escalate = contacts.escalate || item.escalate_to_email;
        if (quiet >= 2 && escalate) emails.push(escalate); // copy Gabe after 2 quiet days
        const why = etaPassed ? `ETA ${item.eta_date} passed` : `${quiet} day${quiet === 1 ? '' : 's'} no activity`;
        const subject = `${etaPassed ? 'ETA PASSED' : 'STILL OPEN'} — ${item.job_name || 'job'}: ${TYPES[item.service_type] || 'service item'} (${why})`;
        const sent = await notify(base44, { emails, phones: [contacts.phone], sms: [contacts.sms] }, subject, `${summary(item)}\n\nAny update on the job page stops these pings.`, smsText(item, `STILL OPEN (${why})`));
        await api.ServiceItems.update(item.id, { last_ping_at: now, ping_count: (item.ping_count || 0) + 1 });
        results.push({ id: item.id, job: item.job_name, quiet, etaPassed, sent });
      }
      return Response.json({ ok: true, pinged: results.length, results });
    }

    return Response.json({ error: 'unknown_action' }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}

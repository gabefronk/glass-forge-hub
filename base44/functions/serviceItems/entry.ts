import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Service items: the red banner on a job. One record per thing that needs fixing.
// Actions (POST JSON):
//   open     — create from a field report (job_id, service_type, description, unit, photos,
//              source_note_id, source_event_id, request_key). Notifies the owner (Milan):
//              email + text (email-to-SMS) + to-do. Deduped by request_key.
//   update   — { id, status?, note?, eta_date?, tracking?, supplier?, order_ref?, cause?,
//              cost_owner?, service_event_id?, service_date?, owner_member_key? }.
//              Any change stamps last_activity_at and resets the ping clock.
//   ping     — daily (07:00 Denver workflow): every open item with no activity since
//              yesterday → email + text the owner; after 2 quiet days copy the escalation
//              address. Also pings when an ETA has passed without "delivered".
//   list     — { job_id? , open_only? } for the Jobs list / banner.

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

const denverDate = (v = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

async function contactsFor(api, memberKey) {
  // Owner contact: AppSettings.service_owner_email / service_owner_sms (email-to-text address),
  // falling back to the TeamMember's linked auth user email.
  const settings = (await api.AppSettings.list('-created_date', 1, 0).catch(() => []))[0] || {};
  const out = { email: settings.service_owner_email || '', sms: settings.service_owner_sms || '', escalate: settings.service_escalate_email || '', memberId: '' };
  const members = await api.TeamMember.list('id', 100, 0).catch(() => []);
  const member = members.find((m) => m.member_key === memberKey) || members.find((m) => /^milan/i.test(String(m.display_name || '')));
  if (member) {
    out.memberId = member.id;
    if (!out.email && member.auth_user_ids?.length) {
      const users = await api.User.list('id', 200, 0).catch(() => []);
      const u = users.find((x) => member.auth_user_ids.includes(x.id));
      if (u?.email) out.email = u.email;
    }
  }
  return out;
}

async function notify(base44, to, subject, body) {
  const sent = [];
  for (const addr of to.filter(Boolean)) {
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({ to: addr, subject, body });
      sent.push(addr);
    } catch (_) { /* best effort */ }
  }
  return sent;
}

function summary(item, origin) {
  const link = `${origin}/jobs/${item.job_id}`;
  return [
    `Job: ${item.job_name || item.job_id}`,
    `Issue: ${TYPES[item.service_type] || 'Action needed'}${item.unit ? ` — ${item.unit}` : ''}`,
    `Status: ${LABELS[item.status] || item.status}`,
    item.eta_date ? `ETA: ${item.eta_date}` : '',
    `Note: ${item.description || '(none)'}`,
    `Open job: ${link}`,
  ].filter(Boolean).join('\n');
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    const api = base44.asServiceRole.entities;
    const now = new Date().toISOString();
    const origin = (() => { try { return new URL(req.url).origin; } catch { return ''; } })();

    // The daily workflow calls ping with no user; everything else needs a login.
    let user = null;
    if (action !== 'ping') {
      user = await base44.auth.me().catch(() => null);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const who = user?.email || 'system';

    if (action === 'list') {
      const filter = body.job_id ? { job_id: body.job_id } : {};
      let items = await api.ServiceItems.filter(filter, '-created_date', 500, 0);
      if (body.open_only) items = items.filter((i) => OPEN.includes(i.status));
      return Response.json({ ok: true, items });
    }

    if (action === 'open') {
      const { job_id, service_type, description, unit, photos, source_note_id, source_event_id, request_key } = body;
      if (!job_id) return Response.json({ error: 'missing_job' }, { status: 200 });
      if (request_key) {
        const dup = await api.ServiceItems.filter({ request_key }, 'id', 1, 0);
        if (dup.length) return Response.json({ ok: true, item: dup[0], deduped: true });
      }
      const job = await api.Jobs.get(job_id).catch(() => null);
      const contacts = await contactsFor(api, 'milan');
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
        owner_member_key: 'milan',
        escalate_to_email: contacts.escalate || '',
        last_activity_at: now,
        ping_count: 0,
        activity_log: [{ at: now, by: who, action: 'reported', note: description || '' }],
        request_key: request_key || '',
        created_by_email: who,
      });

      // To-do for the owner.
      if (contacts.memberId) {
        const key = `service-item:${item.id}`;
        const existing = await api.TodoTask.filter({ request_key: key }, 'id', 1, 0);
        if (!existing.length) {
          await api.TodoTask.create({
            title: `Service item — ${item.job_name || 'job'}: ${TYPES[item.service_type]}`,
            details: summary(item, origin),
            assignee_member_id: contacts.memberId,
            status: 'open', progress_note: '', due_date: '', category: 'follow_up',
            created_by_user_id: user.id, assigned_by_user_id: user.id,
            completed_at: '', completed_by_user_id: '', archived_at: '', revision: 0,
            request_key: key, seed_key: '', created_at: now, updated_at: now,
          });
        }
      }
      const subject = `SERVICE ITEM — ${item.job_name || 'job'}: ${TYPES[item.service_type]}`;
      const sent = await notify(base44, [contacts.email, contacts.sms], subject, summary(item, origin));
      return Response.json({ ok: true, item, notified: sent });
    }

    if (action === 'update') {
      const { id } = body;
      if (!id) return Response.json({ error: 'missing_params' }, { status: 200 });
      const item = await api.ServiceItems.get(id).catch(() => null);
      if (!item) return Response.json({ error: 'not_found' }, { status: 200 });
      const patch = {};
      for (const k of ['status', 'eta_date', 'tracking', 'supplier', 'order_ref', 'cause', 'cost_owner', 'service_event_id', 'service_date', 'owner_member_key', 'unit', 'description']) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      if (patch.status && !LABELS[patch.status]) return Response.json({ error: 'bad_status' }, { status: 200 });
      if ((patch.status === 'ordered' || patch.status === 'shipped') && !(patch.eta_date || item.eta_date)) {
        return Response.json({ error: 'eta_required' }, { status: 200 });
      }
      if (patch.status === 'closed' || patch.status === 'fixed') {
        if (!body.note && patch.status === 'closed') return Response.json({ error: 'note_required' }, { status: 200 });
        patch.closed_at = now; patch.closed_by = who;
      }
      const entry = { at: now, by: who, action: patch.status ? `status → ${LABELS[patch.status]}` : 'note', note: body.note || '' };
      if (patch.eta_date && patch.eta_date !== item.eta_date) entry.note = `${entry.note ? entry.note + ' · ' : ''}ETA ${patch.eta_date}`;
      patch.activity_log = [...(item.activity_log || []), entry];
      patch.last_activity_at = now;
      patch.ping_count = 0;
      const updated = await api.ServiceItems.update(id, patch);

      // Close out the owner's to-do when the item is done.
      if (patch.status === 'closed' || patch.status === 'cancelled' || patch.status === 'fixed') {
        const todos = await api.TodoTask.filter({ request_key: `service-item:${id}` }, 'id', 1, 0).catch(() => []);
        for (const t of todos) if (t.status !== 'done') await api.TodoTask.update(t.id, { status: 'done', completed_at: now, completed_by_user_id: user.id, updated_at: now }).catch(() => {});
      }
      // Reorders cost money: copy the escalation address when it is ordered.
      if (patch.status === 'ordered' && (updated.escalate_to_email)) {
        await notify(base44, [updated.escalate_to_email], `Reorder placed — ${updated.job_name}`, summary(updated, origin));
      }
      return Response.json({ ok: true, item: updated });
    }

    if (action === 'ping') {
      const today = denverDate();
      const yesterday = denverDate(Date.now() - 86400000);
      const items = await api.ServiceItems.list('-created_date', 500, 0);
      const contacts = await contactsFor(api, 'milan');
      const results = [];
      for (const item of items) {
        if (!OPEN.includes(item.status) || item.status === 'on_hold') continue;
        const lastDay = item.last_activity_at ? denverDate(item.last_activity_at) : denverDate(item.created_date);
        const quiet = lastDay < yesterday || lastDay === yesterday ? daysBetween(lastDay, today) : 0;
        const etaPassed = item.eta_date && item.eta_date < today && ['ordered', 'shipped'].includes(item.status);
        if (quiet < 1 && !etaPassed) continue;
        if (item.last_ping_at && denverDate(item.last_ping_at) === today) continue;
        const pingCount = (item.ping_count || 0) + 1;
        const to = [contacts.email, contacts.sms];
        if (pingCount >= 2 && item.escalate_to_email) to.push(item.escalate_to_email);
        const subject = `${etaPassed ? 'ETA PASSED' : 'STILL OPEN'} — ${item.job_name || 'job'}: ${TYPES[item.service_type] || 'service item'} (${quiet} day${quiet === 1 ? '' : 's'} no activity)`;
        const sent = await notify(base44, to, subject, summary(item, origin));
        await api.ServiceItems.update(item.id, { last_ping_at: now, ping_count: pingCount });
        results.push({ id: item.id, job: item.job_name, quiet, etaPassed, sent });
      }
      return Response.json({ ok: true, pinged: results.length, results });
    }

    return Response.json({ error: 'unknown_action' }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}

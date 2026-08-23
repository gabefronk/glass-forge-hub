import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Resolve a field report flag from the Dashboard / Calendar action buttons.
// Actions:
//   mark_reported — admin/manager only: sets ok + manual (report exists but matcher missed it)
//   waive         — admin only: requires a reason, sets waived
//   upload        — any authenticated user: creates a JobNote with photos/notes, sets ok + manual
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { event_id, action, photos, notes, reason } = body;
    if (!event_id || !action) return Response.json({ error: 'missing_params' }, { status: 200 });

    const event = await base44.asServiceRole.entities.CalendarEvents.get(event_id);
    if (!event) return Response.json({ error: 'event_not_found' }, { status: 200 });

    const now = new Date().toISOString();

    if (action === 'mark_reported') {
      if (user.role !== 'admin' && user.role !== 'manager') {
        return Response.json({ error: 'forbidden' }, { status: 403 });
      }
      await base44.asServiceRole.entities.CalendarEvents.update(event_id, {
        report_status: 'ok',
        match_method: 'manual',
        match_confidence: 1,
        report_checked_at: now,
        days_late: 0,
      });
      return Response.json({ ok: true, action: 'mark_reported' });
    }

    if (action === 'waive') {
      if (user.role !== 'admin') {
        return Response.json({ error: 'forbidden' }, { status: 403 });
      }
      if (!reason || !reason.trim()) {
        return Response.json({ error: 'reason_required' }, { status: 200 });
      }
      await base44.asServiceRole.entities.CalendarEvents.update(event_id, {
        report_status: 'waived',
        waived_by: user.email,
        waived_at: now,
        waive_reason: reason,
        report_checked_at: now,
      });
      return Response.json({ ok: true, action: 'waived' });
    }

    if (action === 'upload') {
      // Create a JobNote with the uploaded photos and notes
      if (event.job_id) {
        await base44.asServiceRole.entities.JobNotes.create({
          job_id: event.job_id,
          note_date: event.event_date,
          body: notes || 'Field report photos uploaded',
          author: user.email,
          attachments: photos || [],
        });
      }
      await base44.asServiceRole.entities.CalendarEvents.update(event_id, {
        report_status: 'ok',
        match_method: 'manual',
        match_confidence: 1,
        report_checked_at: now,
        days_late: 0,
      });
      return Response.json({ ok: true, action: 'upload' });
    }

    return Response.json({ error: 'unknown_action' }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}
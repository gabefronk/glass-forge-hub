import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Resolve a field report flag from the Dashboard / Calendar / Job page action.
// Actions:
//   mark_reported — admin/manager only: sets ok + manual (report exists but matcher missed it)
//   waive         — admin only: requires a reason, sets waived
//   upload        — any authenticated user: creates a JobNote with photos/notes, sets ok + manual
//                   Accepts an optional `completion` ('complete' | 'incomplete') captured from the
//                   job-page upload flow. When 'incomplete', creates a to-do task for Milan (resolved
//                   dynamically from TeamMember by display name) so he can check and get it fixed.
//                   Deduped by request_key so a retried submit does not create a second alert.
//                   Works with either event_id (appointment report) or job_id (general report).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { event_id, action, photos, notes, reason, completion, job_id, request_key } = body;
    if (!action) return Response.json({ error: 'missing_params' }, { status: 200 });

    const now = new Date().toISOString();
    const api = base44.asServiceRole.entities;

    if (action === 'mark_reported') {
      if (user.role !== 'admin' && user.role !== 'manager') {
        return Response.json({ error: 'forbidden' }, { status: 403 });
      }
      if (!event_id) return Response.json({ error: 'missing_params' }, { status: 200 });
      await api.CalendarEvents.update(event_id, {
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
      if (!event_id) return Response.json({ error: 'missing_params' }, { status: 200 });
      if (!reason || !reason.trim()) {
        return Response.json({ error: 'reason_required' }, { status: 200 });
      }
      await api.CalendarEvents.update(event_id, {
        report_status: 'waived',
        waived_by: user.email,
        waived_at: now,
        waive_reason: reason,
        report_checked_at: now,
      });
      return Response.json({ ok: true, action: 'waived' });
    }

    if (action === 'upload') {
      const completionValue = completion === 'complete' || completion === 'incomplete' ? completion : '';

      let event = null;
      let jobId = '';
      let jobName = '';
      let noteDate = now.slice(0, 10);

      if (event_id) {
        event = await api.CalendarEvents.get(event_id).catch(() => null);
        if (!event) return Response.json({ error: 'event_not_found' }, { status: 200 });
        jobId = event.job_id || job_id || '';
        jobName = event.job_name || '';
        noteDate = event.event_date || noteDate;
      } else {
        jobId = job_id || '';
      }
      if (!jobId) return Response.json({ error: 'missing_job' }, { status: 200 });

      if (!jobName) {
        const job = await api.Jobs.get(jobId).catch(() => null);
        jobName = job?.canonical_name || '';
      }

      await api.JobNotes.create({
        job_id: jobId,
        note_date: noteDate,
        body: notes || 'Field report photos uploaded',
        author: user.email,
        attachments: photos || [],
        edited: false,
        completion: completionValue,
      });

      if (event_id) {
        await api.CalendarEvents.update(event_id, {
          report_status: 'ok',
          match_method: 'manual',
          match_confidence: 1,
          report_checked_at: now,
          days_late: 0,
        });
      }

      if (completionValue === 'incomplete') {
        const members = await api.TeamMember.list('id', 50, 0);
        const milan = members.find((m) => /^milan/i.test(String(m.display_name || '')));
        if (milan) {
          const key = request_key || `field-report-incomplete:${event_id || jobId}:${noteDate}`;
          const existing = await api.TodoTask.filter({ request_key: key }, 'id', 1, 0);
          if (!existing.length) {
            const link = `/jobs/${jobId}`;
            const details = [
              `Job: ${jobName || jobId}`,
              `Author: ${user.email}`,
              `Time: ${now}`,
              `Note: ${notes || '(no note provided)'}`,
              `Open job: ${link}`,
            ].join('\n');
            await api.TodoTask.create({
              title: `Incomplete field report — ${jobName || 'job'}`,
              details,
              assignee_member_id: milan.id,
              status: 'open',
              progress_note: '',
              due_date: '',
              created_by_user_id: user.id,
              assigned_by_user_id: user.id,
              completed_at: '',
              completed_by_user_id: '',
              archived_at: '',
              revision: 0,
              request_key: key,
              seed_key: '',
              created_at: now,
              updated_at: now,
            });
          }
        }
      }

      return Response.json({ ok: true, action: 'upload', completion: completionValue });
    }

    return Response.json({ error: 'unknown_action' }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}
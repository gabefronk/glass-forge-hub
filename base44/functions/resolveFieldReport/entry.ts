import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { createJobIndex, canonicalJob } from '../../shared/jobIdentity.js';
import { fetchAllPages } from '../../shared/pagination.ts';

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
//                   When the crew also picked "What's needed?" (service_type), the job page opens a
//                   service item instead, and that item carries Milan's one to-do — so no to-do here.
//                   A report filed against a service item's own visit is stamped on that item
//                   (complete → it can be marked Fixed).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { event_id, action, photos, notes, reason, completion, job_id, request_key, service_type } = body;
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

      // File the report on the canonical (oldest) record of the job's customer +
      // address, so a report opened from a duplicate record lands on the job that
      // ingest attaches new visits to. Doubtful groups keep the given record.
      let job = null;
      let index = null;
      try {
        const jobs = await fetchAllPages(api.Jobs, '-created_date', 1000);
        index = createJobIndex(jobs);
        job = canonicalJob(index.byId.get(jobId), index);
      } catch (_) {
        job = null;
      }
      if (job) jobId = job.id;
      if (!jobName) {
        if (!job) job = await api.Jobs.get(jobId).catch(() => null);
        jobName = job?.canonical_name || '';
      }

      const note = await api.JobNotes.create({
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

        // Service visit for an open service item: a complete report clears it to be marked Fixed.
        if (completionValue === 'complete') {
          const items = await api.ServiceItems.filter({ service_event_id: event_id }, '-created_date', 5, 0).catch(() => []);
          for (const it of items) {
            if (['fixed', 'closed', 'cancelled'].includes(it.status)) continue;
            await api.ServiceItems.update(it.id, {
              service_report_note_id: note?.id || '',
              service_report_complete_at: now,
              last_activity_at: now,
              ping_count: 0,
              activity_log: [...(it.activity_log || []), { at: now, by: user.email, action: 'service visit report — complete', note: 'Ready to mark Fixed' }],
            }).catch(() => {});
          }
        }
      }

      // Photos count as the report. A general report (no appointment picked) with photos clears
      // this job's visit from today or the two days before that is still waiting on a report.
      if (!event_id && (photos || []).length) {
        const days = [0, 1, 2].map((n) => new Date(Date.parse(`${noteDate}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10));
        const open = await api.CalendarEvents.filter({ event_date: { $in: days }, report_status: { $in: ['pending', 'missing_photos', 'missing_notes', 'missing_all', 'no_source_data'] } }, '-event_date', 200, 0).catch(() => []);
        const sameJob = (ev) => {
          if (!ev.job_id) return false;
          if (ev.job_id === jobId) return true;
          try { return index ? canonicalJob(index.byId.get(ev.job_id), index)?.id === jobId : false; } catch { return false; }
        };
        const hit = open.filter((ev) => ev.report_required !== false && sameJob(ev)).sort((a, b) => b.event_date.localeCompare(a.event_date))[0];
        if (hit) {
          await api.CalendarEvents.update(hit.id, { report_status: 'ok', match_method: 'manual', match_confidence: 1, report_checked_at: now, days_late: 0 }).catch(() => {});
        }
      }

      if (completionValue === 'incomplete' && !service_type) {
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
              category: 'follow_up',
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

      return Response.json({ ok: true, action: 'upload', completion: completionValue, job_id: jobId, note_id: note?.id || '' });
    }

    return Response.json({ error: 'unknown_action' }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}
import { enqueueCustomerCollection } from '../../shared/enqueueCustomerCollection.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { createJobIndex, canonicalJob } from '../../shared/jobIdentity.js';
import { fetchAllPages } from '../../shared/pagination.ts';
import { textGabeFieldReport } from '../../shared/fieldReportNotify.js';
import {
  isCurrentEventType,
  eventTypeLabel,
  eventFieldScope,
  validateFieldReport,
  priceFieldReport,
  rubricFromRows,
  internalCostState,
  followUpTriggers,
  reschedulingFlags,
  reportSummaryLines,
  buildFollowUpTasks,
  buildInvoiceStagingLine,
  invoiceStagingState,
  feeLineMarker,
  orderedWindowOptions,
  patioDoorDetected,
  halfHours,
} from '../../shared/fieldVisitReport.js';

// Resolve a field report flag from the Dashboard / Calendar / Job page action.
// Actions:
//   form_context  — any authenticated user: the live data the phone form needs that the
//                   crew cannot read itself (TeamMember follow-up recipients are RLS-closed,
//                   and the job's ordered window package lives in an admin-only snapshot
//                   field). Read-only; returns no money and no quote pricing.
//   mark_reported — admin/manager only: sets ok + manual (report exists but matcher missed it)
//   waive         — admin only: requires a reason, sets waived
//   upload        — any authenticated user: files the visit report.
//
// `upload` takes two payload shapes:
//
//   Structured (the redesigned phone form): `event_type` is one of the seven current
//   choices. The whole submit is validated server-side with the shared rules
//   (base44/shared/fieldVisitReport.js), priced server-side from the live PricingRubric
//   (the client sends keys, never amounts), fanned out to one Today Hub item per selected
//   recipient, and recorded on a FieldVisitReports row keyed by `request_key`. That key makes
//   the submit idempotent: a retry or an edited re-submit reuses the row and creates no
//   second job note, no second invoicing staging line and no second Today item.
//
//   Legacy (calendar / dashboard quick upload, pre-redesign clients): no `event_type`.
//   Behaviour is unchanged — JobNote, calendar report_status, rubric charge from
//   ticket_type/hours/material/long_distance, customer-collection enqueue — except that the
//   incomplete alert no longer hardcodes one person's name. It routes to the job's PM
//   TeamMember when the job has one, otherwise to the owner member, and says so
//   (`routing: 'legacy_fallback'`).
//
// Installer Error is never chargeable, on any path: priceFieldReport returns a non-billable
// zero for it, so no FeeLines row is created and nothing reaches the Hub invoicing staging,
// including on retries and edits. The hours/material it recorded still land on the
// FieldVisitReports row with an honest internal-cost state.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      event_id, action, photos, notes, reason, completion, job_id, request_key, service_type,
      ticket_type, hours, material, long_distance,
      // Structured field-visit report payload.
      event_type, incomplete_reason, not_ready, not_ready_reasons, window_issues, items,
      sheetrock_outcomes, screen_issues, cannot_fix, warranty_issue, parts_needed,
      documentation, has_patio_door, recipients,
    } = body;
    if (!action) return Response.json({ error: 'missing_params' }, { status: 200 });

    const now = new Date().toISOString();
    const api = base44.asServiceRole.entities;
    const activeMembers = async () => {
      const rows = await api.TeamMember.list('id', 200, 0).catch(() => []);
      return (Array.isArray(rows) ? rows : []).filter((m) => m && m.active !== false);
    };

    if (action === 'form_context') {
      // Everything the form needs and the crew cannot read directly. No prices.
      const members = await activeMembers();
      const userRows = await api.User.list('id', 200, 0).catch(() => []);
      const roleByUser = new Map((Array.isArray(userRows) ? userRows : []).map((u) => [u.id, u.role || '']));
      let job = null;
      if (job_id) job = await api.Jobs.get(job_id).catch(() => null);
      const windows = orderedWindowOptions(job).filter((w) => !w.other);
      return Response.json({
        ok: true,
        recipients: members.map((m) => ({
          id: m.id,
          member_key: m.member_key || '',
          display_name: m.display_name || m.member_key || '',
          pending_account: !Array.isArray(m.auth_user_ids) || m.auth_user_ids.length === 0,
          role: (m.auth_user_ids || []).map((uid) => roleByUser.get(uid) || '').find(Boolean) || '',
        })),
        windows,
        patio_door_detected: patioDoorDetected(job),
        window_source: windows.length ? 'accepted_quote_snapshot' : 'none',
      });
    }

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
      const structured = isCurrentEventType(event_type);
      const media = Array.isArray(photos) ? photos.filter((u) => typeof u === 'string' && u) : [];

      // The structured report, as the shared rules see it.
      const report = structured ? {
        event_type,
        completion: completionValue,
        incomplete_reason,
        not_ready: not_ready === true,
        not_ready_reasons,
        window_issues,
        items,
        sheetrock_outcomes,
        screen_issues,
        cannot_fix,
        warranty_issue,
        parts_needed,
        documentation,
        has_patio_door: has_patio_door === true,
        hours,
        material,
        long_distance: long_distance === true,
        notes,
        recipients,
      } : null;

      let check = null;
      if (structured) {
        check = validateFieldReport(report);
        if (!check.ok) return Response.json({ error: 'invalid_report', fields: check.errors }, { status: 200 });
        if (!request_key) return Response.json({ error: 'missing_request_key' }, { status: 200 });
      }

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
        // Follow a combine: notes must land on the surviving job, not the
        // hidden merged-away record (e.g. a calendar row linked pre-merge).
        if (job?.merged_into) {
          const survivor = index.byId.get(job.merged_into);
          if (survivor && !survivor.merged_into) job = canonicalJob(survivor, index);
        }
      } catch (_) {
        job = null;
      }
      if (job) jobId = job.id;
      if (!jobName) {
        if (!job) job = await api.Jobs.get(jobId).catch(() => null);
        jobName = job?.canonical_name || '';
      }

      // ── Idempotency: one settled submit per request_key ────────────────────
      // A retried submit or an edited re-submit of the same opened form reuses this row.
      let visitRow = null;
      if (structured) {
        const prior = await api.FieldVisitReports.filter({ request_key }, '-created_date', 1, 0).catch(() => []);
        visitRow = (Array.isArray(prior) ? prior : [])[0] || null;
        if (visitRow && visitRow.settled === true) {
          return Response.json({
            ok: true, action: 'upload', deduped: true, event_type: visitRow.event_type,
            completion: visitRow.completion || '', job_id: visitRow.job_id,
            note_id: visitRow.job_note_id || '', field_visit_report_id: visitRow.id,
            fee_line_id: visitRow.fee_line_id || '',
            charge_labor_amt: Number(visitRow.charge_labor_amt) || 0,
            invoice_staging_state: visitRow.invoice_staging_state || 'none',
            internal_cost_state: visitRow.internal_cost_state || 'unpriced',
            needs_rescheduling: visitRow.needs_rescheduling === true,
            follow_up_triggers: visitRow.follow_up_triggers || [],
            recipient_task_ids: visitRow.recipient_task_ids || [],
          });
        }
      }

      const summaryLines = structured ? reportSummaryLines(report, { job }) : [];
      const noteBody = structured
        ? (summaryLines.join('\n') || 'Field report photos uploaded')
        : (notes || 'Field report photos uploaded');

      let note = null;
      if (visitRow?.job_note_id) note = await api.JobNotes.get(visitRow.job_note_id).catch(() => null);
      if (!note) {
        note = await api.JobNotes.create({
          job_id: jobId,
          note_date: noteDate,
          body: noteBody,
          author: user.email,
          attachments: media,
          edited: false,
          completion: completionValue,
        });
      }

      if (structured && !visitRow) {
        // Claim the key before any chargeable or alerting side effect, so a retry after a
        // partial failure resumes instead of repeating.
        visitRow = await api.FieldVisitReports.create({
          request_key,
          settled: false,
          job_id: jobId,
          job_name: jobName,
          event_date: noteDate,
          calendar_event_id: event_id || '',
          job_note_id: note?.id || '',
          event_type,
          completion: completionValue,
          author: user.email || '',
          created_at: now,
          updated_at: now,
        }).catch(() => null);
      }

      // ── Pricing ───────────────────────────────────────────────────────────
      // The customer charge comes from the live PricingRubric only, server-side. Installer
      // Error prices to a non-billable zero, so it never produces a FeeLines row.
      let feeLine = null;
      let price = null;
      let costState = null;
      const marker = structured ? feeLineMarker(request_key) : '';
      try {
        if (structured) {
          const rubric = rubricFromRows(await api.PricingRubric.list('sort', 200, 0).catch(() => []));
          price = priceFieldReport({ eventType: event_type, hours, material, longDistance: long_distance === true, rubric });
          // Internal cost never reads the rubric: those hourly rates are customer sell rates.
          // With no verified internal rate anywhere in the Hub, this stays pending.
          costState = internalCostState({ eventType: event_type, hours, material, costSources: await internalCostSources(api, jobId) });

          if (visitRow?.fee_line_id) feeLine = await api.FeeLines.get(visitRow.fee_line_id).catch(() => null);
          if (!feeLine) {
            // Second guard against a double charge: an existing field_report line on this job
            // already carrying this submit's marker is this submit's line.
            const existingLines = await api.FeeLines.filter({ job_id: jobId, source: 'field_report' }, '-created_date', 50, 0).catch(() => []);
            feeLine = (Array.isArray(existingLines) ? existingLines : []).find((l) => String(l.note_text || '').includes(marker)) || null;
          }
          if (!feeLine) {
            const staging = buildInvoiceStagingLine({
              price, report, requestKey: request_key, jobId, jobName, jobDate: noteDate,
              calendarEventId: (event && event.google_event_id) || '', media, author: user.email,
            });
            if (staging) {
              feeLine = await api.FeeLines.create(staging)
                .catch((e) => { console.log('field report fee line failed:', (e && e.message) || e); return null; });
            }
          }
        } else {
          // Legacy payload: unchanged rubric charge from the old pickers.
          const hrs = halfHours(hours);
          const ld = !!long_distance;
          if (ticket_type || hrs > 0 || material || ld) {
            const rows = await api.PricingRubric.list('sort', 200, 0).catch(() => []);
            const active = (Array.isArray(rows) ? rows : []).filter((r) => r && !r.retired);
            const ttRow = active.find((r) => r.kind === 'ticket_type' && (r.key === ticket_type || r.label === ticket_type)) || null;
            const matRow = active.find((r) => r.kind === 'material' && (r.key === material || r.label === material)) || null;
            const ldAmt = Number((active.find((r) => r.kind === 'setting' && r.key === 'long_distance') || {}).amount) || 0;
            const visitFee = ttRow ? Number(ttRow.visit_fee) || 0 : 0;
            const rate = matRow ? Number(matRow.hourly_rate) || 0 : 0;
            const trip = ld ? 1 : 0;
            const laborAmt = Math.round((visitFee + hrs * rate + trip * ldAmt) * 100) / 100;
            if (laborAmt > 0) {
              const parts = [`${(ttRow && ttRow.label) || 'Visit'} visit${visitFee ? ` $${visitFee}` : ''}`];
              if (hrs > 0) parts.push(`${hrs} h x $${rate}${matRow ? ` ${matRow.label}` : ''}`);
              if (trip) parts.push(`long distance $${ldAmt}`);
              feeLine = await api.FeeLines.create({
                job_id: jobId,
                job_date: noteDate,
                invoice_month: String(noteDate || '').slice(0, 7),
                job_name_raw: String(jobName || '').toUpperCase(),
                job_name_norm: String(jobName || '').toLowerCase(),
                line_description: `Field report charge: ${parts.join(' + ')}`,
                man_hours: hrs || null,
                trip_charges: trip || null,
                service_material: material || null,
                service_rate: rate || null,
                labor_amt: laborAmt,
                fee_type: 'labor_pct',
                fee_pct: 0.1,
                fee_amt: Math.round(laborAmt * 0.1 * 100) / 100,
                manually_adjusted: true,
                billable: true,
                billed_to_bfs: false,
                paid_to_ya: false,
                invoiced_to_ya: false,
                source: 'field_report',
                written_by: user.email || 'field_report',
                match_confidence: 'high',
                calendar_event_id: (event && event.google_event_id) || null,
                photo_urls: media,
              }).catch((e) => { console.log('field report fee line failed:', (e && e.message) || e); return null; });
            }
          }
        }
      } catch (e) {
        console.log('field report rubric charge skipped:', (e && e.message) || e);
      }

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
          const serviceItems = await api.ServiceItems.filter({ service_event_id: event_id }, '-created_date', 5, 0).catch(() => []);
          for (const it of serviceItems) {
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
      if (!event_id && media.length) {
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

      // ── Follow-up fan-out: one Today Hub item per selected recipient ───────
      const triggers = structured ? followUpTriggers(report) : (completionValue === 'incomplete' && !service_type ? ['incomplete_work'] : []);
      let routing = '';
      let chosen = [];
      const taskIds = [];
      if (triggers.length) {
        const members = await activeMembers();
        const byId = new Map(members.map((m) => [m.id, m]));
        if (structured) {
          chosen = (check.recipients || []).map((id) => byId.get(id)).filter(Boolean);
          if (!chosen.length) return Response.json({ error: 'recipients_required' }, { status: 200 });
          routing = 'selected';
        } else {
          // Pre-redesign payload: no recipient list to honour. Route to the job's PM
          // TeamMember, else the owner member. Stable ids only — never a name match.
          const pm = job?.pm_member_key ? members.find((m) => m.member_key === job.pm_member_key) : null;
          const owner = members.find((m) => m.member_key === 'gabriel');
          chosen = [pm || owner].filter(Boolean);
          routing = 'legacy_fallback';
        }

        // A legacy payload carries no event_type, so its Today item keeps the old wording.
        const tasks = buildFollowUpTasks({
          report: structured ? report : { event_type: '', completion: 'incomplete', notes },
          requestKey: request_key || `field-report-incomplete:${event_id || jobId}:${noteDate}`,
          recipients: chosen, job, jobId, jobName,
          originPath: structured && visitRow?.id ? `/jobs/${jobId}?report=${visitRow.id}` : `/jobs/${jobId}`,
          author: user.full_name || user.email, now,
          createdByUserId: user.id, assignedByUserId: user.id,
        }).map((t) => (structured ? t : { ...t, title: `Incomplete field report — ${jobName || 'job'}`.slice(0, 200) }));

        for (const task of tasks) {
          const existing = await api.TodoTask.filter({ request_key: task.request_key }, 'id', 1, 0).catch(() => []);
          if ((Array.isArray(existing) ? existing : []).length) { taskIds.push(existing[0].id); continue; }
          const created = await api.TodoTask.create(task).catch((e) => { console.log('follow-up task failed:', (e && e.message) || e); return null; });
          if (created?.id) taskIds.push(created.id);
        }
      }

      // Crew upload -> text Gabe (this action only runs from the signed-in app UI, so
      // automations never reach it; Gabe's own uploads are skipped). Dedup: a double
      // submit that already produced an identical note in the last 2 minutes sends nothing.
      if (user.email !== 'gabefronk@gmail.com') {
        try {
          const recent = await api.JobNotes.filter({ job_id: jobId, author: user.email }, '-created_date', 5, 0).catch(() => []);
          const dup = (recent || []).some((n) => n.id !== note?.id
            && (n.body || '') === noteBody
            && (n.attachments || []).length === media.length
            && Date.parse(now) - Date.parse(n.created_date || 0) < 120000);
          if (!dup) {
            await textGabeFieldReport({
              jobName: jobName || 'job',
              completion: completionValue,
              note: structured ? `${eventTypeLabel(event_type)}: ${summaryLines[summaryLines.length - 1] || ''}` : notes,
              author: user.full_name || user.email,
            });
          }
        } catch (_) { /* a failed text never blocks the report */ }
      }

      let customerCollection = null;
      try { customerCollection = await enqueueCustomerCollection(api, { jobId, note, now }); }
      catch (_) { customerCollection = { state: 'collection_review_required' }; }

      // ── Settle the structured record ──────────────────────────────────────
      const flags = structured ? reschedulingFlags(report) : { needs_rescheduling: false, rescheduling_reason: '', rescheduled_date: null };
      const staging = structured ? invoiceStagingState({ eventType: event_type, price }) : 'none';
      if (structured && visitRow?.id) {
        const scope = eventFieldScope(event_type);
        await api.FieldVisitReports.update(visitRow.id, {
          settled: true,
          job_note_id: note?.id || visitRow.job_note_id || '',
          incomplete_reason: String(incomplete_reason || ''),
          not_ready: not_ready === true,
          not_ready_reasons: Array.isArray(not_ready_reasons) ? not_ready_reasons : [],
          window_issues: Array.isArray(window_issues) ? window_issues : [],
          items: Array.isArray(items) ? items : [],
          sheetrock_outcomes: Array.isArray(sheetrock_outcomes) ? sheetrock_outcomes : [],
          screen_issues: Array.isArray(screen_issues) ? screen_issues : [],
          cannot_fix: Array.isArray(cannot_fix) ? cannot_fix : [],
          warranty_issue: warranty_issue && typeof warranty_issue === 'object' ? warranty_issue : {},
          parts_needed: String(parts_needed || ''),
          documentation: documentation && typeof documentation === 'object' ? documentation : {},
          has_patio_door: has_patio_door === true,
          needs_rescheduling: flags.needs_rescheduling,
          rescheduling_reason: flags.rescheduling_reason,
          rescheduled_date: '',
          follow_up_triggers: triggers,
          recipients: chosen.map((m) => m.id),
          recipient_task_ids: taskIds,
          routing,
          media_urls: media,
          notes: String(notes || ''),
          // Internal record of the hours / material the visit recorded, kept even when the
          // visit is not chargeable (Installer Error).
          hours: scope.hours ? halfHours(hours) : null,
          material: scope.material ? String(material || '') : '',
          long_distance: scope.longDistance && long_distance === true,
          billable: !!(price && price.billable),
          fee_line_id: feeLine?.id || '',
          charge_labor_amt: feeLine ? Number(feeLine.labor_amt) || 0 : 0,
          invoice_staging_state: staging,
          internal_cost_state: costState?.state || 'unpriced',
          internal_cost_amount: costState?.amount ?? null,
          internal_cost_reason: costState?.reason || '',
          updated_at: now,
        }).catch((e) => { console.log('field visit report settle failed:', (e && e.message) || e); });
      }

      return Response.json({
        ok: true,
        action: 'upload',
        event_type: structured ? event_type : '',
        completion: completionValue,
        job_id: jobId,
        note_id: note?.id || '',
        field_visit_report_id: structured ? visitRow?.id || '' : '',
        customer_collection: customerCollection,
        fee_line_id: feeLine?.id || '',
        charge_labor_amt: feeLine ? Number(feeLine.labor_amt) || 0 : 0,
        charge_fee_amt: feeLine ? Number(feeLine.fee_amt) || 0 : 0,
        invoice_staging_state: staging,
        internal_cost_state: costState?.state || '',
        internal_cost_reason: costState?.reason || '',
        needs_rescheduling: flags.needs_rescheduling,
        rescheduling_reason: flags.rescheduling_reason,
        follow_up_triggers: triggers,
        recipient_task_ids: taskIds,
        routing,
      });
    }

    return Response.json({ error: 'unknown_action' }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}

// Real internal cost sources for a job's labour, in the order the Hub trusts them.
// There is deliberately no PricingRubric read here: PricingRubric.hourly_rate is the customer
// sell rate, not a verified internal cost. JobCostInputs.actual_labor_cost is a job total, not
// an hourly rate, so it cannot price one visit's hours — hence no rate, and a pending state.
async function internalCostSources(api, jobId) {
  try {
    const rows = await api.JobCostInputs.filter({ job_id: jobId }, '-created_date', 5, 0).catch(() => []);
    const row = (Array.isArray(rows) ? rows : [])[0] || null;
    if (!row) return { internal_labor_rate_per_hour: null, internal_material_cost: null, source: '' };
    return {
      // Only a genuine per-hour internal rate may price a visit. None is recorded today.
      internal_labor_rate_per_hour: Number.isFinite(Number(row.internal_labor_rate_per_hour)) ? Number(row.internal_labor_rate_per_hour) : null,
      internal_material_cost: null,
      source: 'JobCostInputs',
    };
  } catch (_) {
    return { internal_labor_rate_per_hour: null, internal_material_cost: null, source: '' };
  }
}

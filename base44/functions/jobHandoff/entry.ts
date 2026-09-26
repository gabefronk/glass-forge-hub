import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { STAGES, evaluateChecklist, readiness, buildSummary, buildTodoRow, buildKickoffEvent, buildHandoffNote, cleanChecklistInput, todoRequestKey, kickoffEventId, isIsoDay } from '../../shared/jobHandoff.js';
import { denverDate } from '../../shared/billingCore.js';

// Stage 2 handoff (Gabe → PM). POST { action, job_id, ... }, admin + manager only:
//   get         the job's handoff row (or an empty draft), the evaluated checklist, who it can go to
//   save_draft  store the checklist / dates / note without submitting
//   submit      save, require every item to pass, then: job → handed_off + pm, one to-do on the
//               PM's Follow-ups lane (due start date), one Hub-only kickoff event, one job note
//   update      after submit: new ETA / start date / note → to-do, event and summary follow
//   set_stage   move the job's stage by hand (hero chip)
// All writes are service-role; nothing here is reachable by the crew role.

const json = (body, status = 200) => Response.json(body, { status });
const str = (v, cap = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const htmlToText = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function resolveContact(db, jobId, role) {
  const links = await db.ContactJobLink.filter({ job_id: jobId, role }, '-created_date', 3).catch(() => []);
  for (const l of links || []) {
    const rows = await db.HubContacts.filter({ key: l.contact_key }, '-created_date', 1).catch(() => []);
    const c = (rows || [])[0];
    if (c) return { key: c.key, name: str(c.name, 120), phone: str(c.phone, 40), email: str(c.email, 120) };
  }
  return links && links.length ? { key: links[0].contact_key, name: '', phone: '', email: '' } : null;
}

async function scopeFor(db, jobId) {
  const evs = await db.CalendarEvents.filter({ job_id: jobId }, '-event_date', 20).catch(() => []);
  const withScope = (evs || []).find((e) => e.scope_notes && e.source_status !== 'cancelled') || (evs || []).find((e) => e.scope_notes);
  if (withScope) return htmlToText(withScope.scope_notes).slice(0, 4000);
  const notes = await db.JobNotes.filter({ job_id: jobId }, '-note_date', 5).catch(() => []);
  const n = (notes || []).find((x) => x.interaction_type !== 'email' && !String(x.author || '').startsWith('Handoff'));
  return n ? htmlToText(n.body).slice(0, 4000) : '';
}

async function members(db) {
  const rows = await db.TeamMember.list('display_name', 200).catch(() => []);
  return (rows || []).filter((m) => m.active !== false && m.member_key).map((m) => ({ id: m.id, member_key: m.member_key, display_name: m.display_name || m.member_key }));
}
const defaultPm = (list) => list.find((m) => /^milan/i.test(m.display_name || '')) || null;

// Everything the card needs, computed fresh from the job.
async function facts(db, job, handoff) {
  const [budgets, orders, superContact, homeowner, scopeText] = await Promise.all([
    db.JobBudgets.filter({ job_id: job.id }, '-created_date', 1).catch(() => []),
    db.VendorOrders.filter({ job_id: job.id }, '-created_date', 3).catch(() => []),
    resolveContact(db, job.id, 'superintendent'),
    resolveContact(db, job.id, 'homeowner'),
    scopeFor(db, job.id),
  ]);
  const budget = (budgets || [])[0] || null;
  const orderEta = (orders || []).map((o) => o.eta_date).find(isIsoDay) || '';
  const eta = isIsoDay(handoff?.eta_date) ? handoff.eta_date : (isIsoDay(budget?.glass_eta_date) ? budget.glass_eta_date : orderEta);
  return { job, eta_date: eta, eta_source: handoff?.eta_date ? 'handoff' : eta ? 'vendor' : '', po_number: handoff?.po_number || '', folder_link: handoff?.folder_link || '', budget, superContact, homeowner, scopeText };
}

function view(job, handoff, f, items, list) {
  const r = readiness(items);
  const to = handoff?.to_member_key ? list.find((m) => m.member_key === handoff.to_member_key) : null;
  return {
    status: 'ok',
    job: { id: job.id, name: job.canonical_name, builder: job.builder || '', address: job.address || '', stage: job.stage || '', pm_member_key: job.pm_member_key || '', po_numbers: job.po_numbers || [], oe_numbers: job.oe_numbers || [], folder_url: job.drive_job_folder_url || '' },
    handoff: handoff ? { id: handoff.id, status: handoff.status, to_member_key: handoff.to_member_key || '', to_name: handoff.to_name || to?.display_name || '', from_name: handoff.from_name || '', start_date: handoff.start_date || '', eta_date: f.eta_date, eta_source: f.eta_source, po_number: handoff.po_number || '', folder_link: handoff.folder_link || '', notes: handoff.notes || '', summary: handoff.summary || '', submitted_at: handoff.submitted_at || '', todo_id: handoff.todo_id || '', calendar_event_id: handoff.calendar_event_id || '', history: handoff.history || [] } : { id: '', status: 'draft', to_member_key: defaultPm(list)?.member_key || '', to_name: defaultPm(list)?.display_name || '', start_date: '', eta_date: f.eta_date, eta_source: f.eta_source, po_number: '', folder_link: '', notes: '', summary: '', submitted_at: '', todo_id: '', calendar_event_id: '', history: [] },
    items,
    ready: r.ready,
    missing: r.missing,
    contacts: { super: f.superContact, homeowner: f.homeowner },
    scope_text: f.scopeText,
    members: list,
    stages: STAGES,
  };
}

function draftPatch(body, existing) {
  const patch = {};
  if (body.checklist !== undefined) patch.checklist = cleanChecklistInput(body.checklist);
  if (body.eta_date !== undefined) patch.eta_date = isIsoDay(body.eta_date) ? body.eta_date : '';
  if (body.start_date !== undefined) patch.start_date = isIsoDay(body.start_date) ? body.start_date : '';
  if (body.notes !== undefined) patch.notes = String(body.notes || '').trim().slice(0, 2000);
  if (body.po_number !== undefined) patch.po_number = str(body.po_number, 40);
  if (body.folder_link !== undefined) patch.folder_link = str(body.folder_link, 500);
  if (body.to_member_key !== undefined) patch.to_member_key = str(body.to_member_key, 80);
  if (!existing) patch.status = 'draft';
  return patch;
}

export default async function jobHandoff(req) {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return json({ error: 'forbidden' }, 403);
  const body = await req.json().catch(() => ({}));
  const db = base44.asServiceRole.entities;
  const action = String(body.action || 'get');
  const jobId = str(body.job_id, 100);
  if (!jobId) return json({ error: 'job_id is required' }, 400);
  const job = await db.Jobs.get(jobId).catch(() => null);
  if (!job) return json({ error: 'job not found' }, 404);
  const fromName = str(user.full_name || user.email, 80);
  const now = new Date().toISOString();
  const today = denverDate();

  if (action === 'set_stage') {
    const stage = str(body.stage, 30);
    if (stage && !STAGES.includes(stage)) return json({ error: 'unknown stage' }, 400);
    const updated = await db.Jobs.update(job.id, { stage: stage || null });
    return json({ status: 'ok', stage: updated.stage || '' });
  }

  const list = await members(db);
  let handoff = ((await db.JobHandoffs.filter({ job_id: job.id }, '-created_date', 1).catch(() => [])) || [])[0] || null;

  if (action === 'get') {
    const f = await facts(db, job, handoff);
    return json(view(job, handoff, f, evaluateChecklist(f, handoff?.checklist || []), list));
  }

  if (action === 'save_draft' || action === 'submit' || action === 'update') {
    if (action === 'update' && (!handoff || handoff.status === 'draft')) return json({ error: 'nothing submitted yet' }, 409);
    const patch = draftPatch(body, handoff);
    const to = list.find((m) => m.member_key === (patch.to_member_key ?? handoff?.to_member_key)) || defaultPm(list);
    if (to) { patch.to_member_key = to.member_key; patch.to_member_id = to.id; patch.to_name = to.display_name; }
    if (!handoff) patch.from_email = user.email; if (!handoff) patch.from_name = fromName;
    handoff = handoff ? await db.JobHandoffs.update(handoff.id, patch) : await db.JobHandoffs.create({ job_id: job.id, ...patch });
    if (action === 'save_draft') {
      const f = await facts(db, job, handoff);
      return json(view(job, handoff, f, evaluateChecklist(f, handoff.checklist || []), list));
    }

    // submit / update: the checklist must pass, then the three artifacts are created or refreshed.
    const f = await facts(db, job, handoff);
    const items = evaluateChecklist(f, handoff.checklist || []);
    const r = readiness(items);
    if (!r.ready) return json({ error: 'not ready', missing: r.missing, ...view(job, handoff, f, items, list) }, 400);
    if (!isIsoDay(handoff.start_date)) return json({ error: 'start date required', missing: ['Start date'], ...view(job, handoff, f, items, list) }, 400);
    if (!to) return json({ error: 'no PM to hand off to — add the person under To-do → Team first' }, 400);

    const summary = buildSummary({ job, handoff: { ...handoff, eta_date: f.eta_date }, items, superContact: f.superContact, homeowner: f.homeowner, scopeText: f.scopeText, fromName: handoff.from_name || fromName });
    const changes = [];
    // Job: stage, PM, typed PO.
    const jobPatch = { stage: 'handed_off', pm_member_key: to.member_key, handoff_id: handoff.id };
    const typedPo = str(handoff.po_number, 40);
    if (typedPo && !(job.po_numbers || []).some((p) => str(p, 40).toUpperCase() === typedPo.toUpperCase())) { jobPatch.po_numbers = [...(job.po_numbers || []), typedPo]; changes.push(`PO ${typedPo} added to the job`); }
    await db.Jobs.update(job.id, jobPatch);
    // To-do on the PM's board (one per job).
    const todoRow = buildTodoRow({ job, handoff, summary, assigneeMemberId: to.id, userId: user.id || 'hub', fromName: handoff.from_name || fromName, now });
    const existingTodo = ((await db.TodoTask.filter({ request_key: todoRequestKey(job.id) }, 'id', 1).catch(() => [])) || [])[0];
    let todoId = existingTodo?.id || handoff.todo_id || '';
    if (existingTodo) await db.TodoTask.update(existingTodo.id, { title: todoRow.title, details: todoRow.details, due_date: todoRow.due_date, assignee_member_id: to.id, updated_at: now, ...(existingTodo.status === 'done' && action === 'submit' ? { status: 'open', completed_at: '', completed_by_user_id: '' } : {}) });
    else todoId = (await db.TodoTask.create(todoRow)).id;
    // Kickoff event (Hub-only).
    const evRow = buildKickoffEvent({ job, handoff, toName: to.display_name, createdBy: user.email, summary });
    const existingEv = ((await db.CalendarEvents.filter({ google_event_id: kickoffEventId(job.id) }, '-created_date', 1).catch(() => [])) || [])[0];
    let eventId = existingEv?.id || handoff.calendar_event_id || '';
    if (existingEv) await db.CalendarEvents.update(existingEv.id, { event_date: evRow.event_date, job_name: evRow.job_name, scope_notes: evRow.scope_notes, source_status: 'confirmed' });
    else eventId = (await db.CalendarEvents.create(evRow)).id;
    // Job note (once at submit; updates log a line).
    let noteId = handoff.note_id || '';
    if (action === 'submit' && !noteId) noteId = (await db.JobNotes.create(buildHandoffNote({ job, handoff: { ...handoff, eta_date: f.eta_date }, fromName: handoff.from_name || fromName, toName: to.display_name, today }))).id;
    const what = action === 'submit' ? `Submitted to ${to.display_name}` : `Updated: starts ${handoff.start_date}${f.eta_date ? `, ETA ${f.eta_date}` : ''}`;
    const history = [...(handoff.history || []), { at: now, by: fromName, what }].slice(-30);
    handoff = await db.JobHandoffs.update(handoff.id, { status: action === 'submit' ? 'submitted' : handoff.status, summary, todo_id: todoId, calendar_event_id: eventId, note_id: noteId, submitted_at: action === 'submit' ? now : (handoff.submitted_at || now), history });
    const fresh = await db.Jobs.get(job.id).catch(() => ({ ...job, ...jobPatch }));
    return json({ ...view(fresh, handoff, f, items, list), changes: [what, ...changes] });
  }

  return json({ error: 'unknown action' }, 400);
}

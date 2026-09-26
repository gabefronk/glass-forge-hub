// Stage 2 handoff: a sold, ordered, documented job goes from Gabe to the PM (Milan). Pure
// helpers — the checklist and what passes it, readiness, the packet text, and the rows the
// submit creates (to-do, kickoff event, job note). No I/O; jobHandoff/entry.ts drives it and
// the job page card renders it. Tested in tests/jobHandoff.test.mjs.

export const HUB_URL = 'https://glass-forge-hub.base44.app';

export const STAGES = ['quoted', 'sold', 'ordered', 'handed_off', 'scheduled', 'installed', 'closed'];
export const STAGE_LABELS = { quoted: 'Quoted', sold: 'Sold', ordered: 'Ordered', handed_off: 'Handed off', scheduled: 'Scheduled', installed: 'Installed', closed: 'Closed' };
export const STAGE_NUMBER = { quoted: 1, sold: 1, ordered: 1, handed_off: 2, scheduled: 3, installed: 3, closed: 4 };
export const stageLabel = (s) => STAGE_LABELS[s] || '';

export const CHECKLIST = Object.freeze([
  { key: 'po', label: 'Order placed — PO on the job', required: true, kind: 'po', hint: 'Auto-passes with a PO in the job facts; or type it here and it saves to the job.' },
  { key: 'eta', label: 'Vendor ETA', required: true, kind: 'date', hint: 'Prefills from the vendor order / budget when there is one.' },
  { key: 'plans', label: 'Architectural plans', required: true, kind: 'upload_or_folder', hint: 'Attach the PDF, or link the job folder (Drive or OneDrive).' },
  { key: 'order_doc', label: 'Order confirmation / vendor quote', required: true, kind: 'upload_or_budget', hint: 'Attach the file, or a quote budget already on this job counts.' },
  { key: 'contacts', label: 'Super on file', required: true, kind: 'contacts', hint: 'From the hero. Homeowner is a warning, not a blocker.' },
  { key: 'scope', label: 'Scope notes written', required: true, kind: 'scope', hint: 'Tick it once the Scope card says what the job is.' },
]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
export const isIsoDay = (v) => ISO_DAY.test(String(v || ''));

export function fmtDate(iso) {
  if (!isIsoDay(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const savedItem = (saved, key) => (Array.isArray(saved) ? saved : []).find((s) => s && s.key === key) || {};

// facts: { job, eta_date, po_number, folder_link, budget, superContact, homeowner, scopeText }
// saved: the handoff row's checklist array (done / value / file_url / file_name per key)
// → items the card renders, each with ok (passes), auto (decided by the Hub), detail, warning.
export function evaluateChecklist(facts = {}, saved = []) {
  const job = facts.job || {};
  const poOnJob = (job.po_numbers || []).map((p) => str(p, 40)).filter(Boolean);
  const typedPo = str(facts.po_number, 40);
  const eta = isIsoDay(facts.eta_date) ? facts.eta_date : '';
  const folderUrl = str(job.drive_job_folder_url, 500) || str(facts.folder_link, 500);
  const budget = facts.budget || null;
  const superC = facts.superContact || null;
  const homeowner = facts.homeowner || null;
  const scopeText = str(facts.scopeText, 4000);

  return CHECKLIST.map((spec) => {
    const s = savedItem(saved, spec.key);
    const base = { ...spec, done: s.done === true, value: str(s.value, 500), file_url: str(s.file_url, 1000), file_name: str(s.file_name, 200), ok: false, auto: false, detail: '', warning: '' };
    switch (spec.kind) {
      case 'po': {
        const pos = [...new Set([...poOnJob, ...(typedPo ? [typedPo] : [])])];
        return { ...base, ok: pos.length > 0, auto: true, value: typedPo, detail: pos.length ? `PO ${pos.join(', ')}` : 'No PO on the job yet' };
      }
      case 'date':
        return { ...base, ok: !!eta, auto: true, value: eta, detail: eta ? `ETA ${fmtDate(eta)}` : 'No ETA yet' };
      case 'upload_or_folder': {
        const ok = !!(base.file_url || folderUrl);
        const detail = base.file_url ? `Attached: ${base.file_name || 'file'}` : job.drive_job_folder_url ? 'Job folder linked (Drive)' : folderUrl ? 'Folder link on file' : 'No plans attached and no folder linked';
        return { ...base, ok, auto: !base.file_url, detail };
      }
      case 'upload_or_budget': {
        const ok = !!(base.file_url || (budget && (budget.source_pdf_name || budget.quote_number)));
        const detail = base.file_url ? `Attached: ${base.file_name || 'file'}` : budget && (budget.source_pdf_name || budget.quote_number) ? `Quote on the job: ${budget.source_pdf_name || budget.quote_number}` : 'No order confirmation attached';
        return { ...base, ok, auto: !base.file_url, detail };
      }
      case 'contacts': {
        const ok = !!(superC && (superC.name || superC.phone));
        const detail = ok ? `Super: ${[superC.name, superC.phone].filter(Boolean).join(' · ')}` : 'No super saved on the job';
        const warning = ok && !(homeowner && (homeowner.name || homeowner.phone)) ? 'No homeowner on file yet' : '';
        return { ...base, ok, auto: true, detail, warning };
      }
      case 'scope': {
        const has = scopeText.length > 0;
        return { ...base, ok: base.done && has, auto: false, detail: has ? `Scope card: ${scopeText.slice(0, 80)}${scopeText.length > 80 ? '…' : ''}` : 'Scope card is empty', warning: base.done && !has ? 'Ticked, but the Scope card is empty' : '' };
      }
      default:
        return base;
    }
  });
}

export function readiness(items) {
  const missing = (items || []).filter((i) => i.required && !i.ok).map((i) => i.label);
  return { ready: missing.length === 0, missing };
}

export const todoRequestKey = (jobId) => `handoff:${String(jobId || '').replace(/[^A-Za-z0-9:_-]/g, '_')}`.slice(0, 180);
export const kickoffEventId = (jobId) => `gfjobs-handoff-${String(jobId || '')}`;
export const jobUrl = (jobId) => `${HUB_URL}/jobs/${encodeURIComponent(String(jobId || ''))}`;

const person = (c) => (c ? [c.name, c.phone, c.email].map((v) => str(v, 120)).filter(Boolean).join(' · ') : '') || '—';

// The packet Milan gets: the job tab, in one block of text.
export function buildSummary({ job = {}, handoff = {}, items = [], superContact = null, homeowner = null, scopeText = '', fromName = '' } = {}) {
  const name = str(job.canonical_name, 200) || 'Job';
  const builder = str(job.builder, 120);
  const po = [...new Set([...(job.po_numbers || []), ...(handoff.po_number ? [handoff.po_number] : [])].map((p) => str(p, 40)).filter(Boolean))];
  const oe = (job.oe_numbers || []).map((p) => str(p, 40)).filter(Boolean);
  const files = (items || []).filter((i) => i.file_url).map((i) => `${i.file_name || i.label}: ${i.file_url}`);
  const folder = str(job.drive_job_folder_url, 500) || str(handoff.folder_link, 500);
  const lines = [
    `${name}${builder ? ` — ${builder}` : ''}`,
    `Handed off by ${str(fromName, 80) || 'the office'}${handoff.start_date ? ` · starts ${fmtDate(handoff.start_date)}` : ''}`,
    `Address: ${str(job.address, 200) || '—'}`,
    `Super: ${person(superContact)}`,
    `Homeowner: ${person(homeowner)}`,
    `PO: ${po.length ? po.join(', ') : '—'} · OE: ${oe.length ? oe.join(', ') : '—'}`,
    `ETA: ${handoff.eta_date ? fmtDate(handoff.eta_date) : '—'}`,
    `Folder: ${folder || '—'}`,
  ];
  if (files.length) lines.push('Files:', ...files.map((f) => `- ${f}`));
  const scope = str(scopeText, 600);
  if (scope) lines.push('', `Scope: ${scope}`);
  const note = String(handoff.notes || '').trim().slice(0, 2000);
  if (note) lines.push('', `Note from ${str(fromName, 80) || 'the office'}: ${note}`);
  lines.push('', `Open job: ${jobUrl(job.id)}`);
  return lines.join('\n');
}

// Mirrors base44/shared/todoService.mjs createTask row semantics (fields, blanks, key).
export function buildTodoRow({ job = {}, handoff = {}, summary = '', assigneeMemberId, userId = 'hub', fromName = '', now }) {
  const title = str(`New project: ${job.canonical_name || 'Job'}${handoff.start_date ? ` — starts ${fmtDate(handoff.start_date)}` : ''}${fromName ? ` · from ${fromName}` : ''}`, 200);
  return {
    title,
    details: String(summary || '').slice(0, 5000),
    assignee_member_id: assigneeMemberId,
    status: 'open',
    progress_note: '',
    due_date: isIsoDay(handoff.start_date) ? handoff.start_date : '',
    category: 'follow_up',
    created_by_user_id: userId,
    assigned_by_user_id: userId,
    completed_at: '',
    completed_by_user_id: '',
    archived_at: '',
    revision: 1,
    request_key: todoRequestKey(job.id),
    seed_key: '',
    created_at: now,
    updated_at: now,
  };
}

// Hub-only kickoff on the start date: shows on the Calendar page and the Today run sheet,
// never pushed to Google (synthetic gfjobs* id, so the movers leave it alone).
export function buildKickoffEvent({ job = {}, handoff = {}, toName = '', createdBy = 'hub', summary = '' }) {
  return {
    source: 'app',
    source_status: 'confirmed',
    event_date: handoff.start_date,
    end_date: null,
    start_time: null,
    end_time: null,
    job_name: str(`Kickoff: ${job.canonical_name || 'Job'}${toName ? ` (${toName})` : ''}`, 200),
    job_id: job.id || null,
    job_link_source: 'owner',
    builder: str(job.builder, 120),
    address: str(job.address, 200),
    labor_amt: 0,
    scope_notes: String(summary || '').split('\n').slice(0, 12).join('\n').slice(0, 1500),
    google_event_id: kickoffEventId(job.id),
    created_by: createdBy,
  };
}

export function buildHandoffNote({ job = {}, handoff = {}, fromName = '', toName = '', today }) {
  const when = handoff.start_date ? ` · starts ${fmtDate(handoff.start_date)}` : '';
  const eta = handoff.eta_date ? ` · ETA ${fmtDate(handoff.eta_date)}` : '';
  const note = String(handoff.notes || '').trim();
  return {
    job_id: job.id,
    note_date: today,
    interaction_type: 'note',
    author: `Handoff · ${str(fromName, 80) || 'the office'}`,
    body: [`Handed off to ${toName || 'the PM'}${when}${eta}.`, note ? `Note: ${note}` : '', `Open job: ${jobUrl(job.id)}`].filter(Boolean).join('\n').slice(0, 4000),
    attachments: [],
    edited: false,
    completion: '',
  };
}

// Owner-entered side of the checklist, cleaned for storage.
export function cleanChecklistInput(raw) {
  const keys = new Set(CHECKLIST.map((c) => c.key));
  return (Array.isArray(raw) ? raw : []).filter((r) => r && keys.has(r.key)).map((r) => ({ key: r.key, done: r.done === true, value: str(r.value, 500), file_url: str(r.file_url, 1000), file_name: str(r.file_name, 200) }));
}

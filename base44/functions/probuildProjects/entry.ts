import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { getProbuildIdToken, fetchProbuildProjects } from '../../shared/probuildApi.ts';
import { normalizeJobName } from '../../shared/ingestShared.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Pre-builds ProBuild projects so the crew never makes their own: one ProBuild project per Hub
// job, named with the job's calendar title (what the guys already search for), with the same
// team members as the crew's recent projects. The project is linked to the job
// (ProbuildProjectLink), so every post the crew makes in it lands on that job in the Hub.
//
// POST { action, ... }
//   inspect                 read-only: who the token is, team members on recent projects, and
//                           the shape of the newest project. No writes.
//   build { job_id, apply } one job. Already linked -> nothing. A ProBuild project with the same
//                           name already exists -> link it instead of making a second one.
//                           Otherwise create it. Without apply:true it only says what it would do.
//   sync  { days, apply }   every job with a visit on the calendar in the next `days` (default 14)
//                           and no ProBuild project yet -> build. Off until the pilot passes
//                           (AppSettings.probuild_autobuild must be true for apply).
// Writes go to ProBuild's own database (the same path the Hub already reads posts from and edits
// project names through). Called by the owner, or by a scheduled workflow (no user).

const TEAM = '-O7aXXhvthc41u60Koc6';
const DB = `https://probuild-prod.firebaseio.com/teams/${TEAM}`;
const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const json = (v, status = 200) => Response.json(v, { status });
const denverDate = (v = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function tokenUid(idToken) {
  try {
    const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part + '==='.slice((part.length + 3) % 4)));
    return payload.user_id || payload.sub || '';
  } catch { return ''; }
}

// The crew's recent projects carry the whole team; reuse that member list.
function teamMembers(projects, uid) {
  const live = projects.filter((p) => p && !p.deletedAt && p.users).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const ids = new Set(uid ? [uid] : []);
  for (const p of live.slice(0, 5)) for (const k of Object.keys(p.users || {})) ids.add(k);
  return { ids: [...ids], sample: live[0] || null };
}

// Calendar title for the job: the next upcoming visit, else the most recent one.
function calendarTitle(events, today) {
  const evs = events.filter((e) => e.event_date && !/cancel/i.test(e.source_status || '') && e.job_name);
  const next = evs.filter((e) => e.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date))[0];
  const last = evs.sort((a, b) => b.event_date.localeCompare(a.event_date))[0];
  return String((next || last)?.job_name || '').trim();
}

async function buildOne(ctx, jobId, apply) {
  const { api, idToken, uid, projects, members, today } = ctx;
  const job = await api.Jobs.get(jobId).catch(() => null);
  if (!job) return { job_id: jobId, result: 'job_not_found' };
  if (job.merged_into) return buildOne(ctx, job.merged_into, apply);
  const link = (await api.ProbuildProjectLink.filter({ job_id: job.id }, '-updated_date', 1).catch(() => []))[0];
  if (link) return { job_id: job.id, result: 'already_linked', project_id: link.project_id, project_name: link.project_name };

  const events = await api.CalendarEvents.filter({ job_id: job.id }, '-event_date', 50).catch(() => []);
  const name = calendarTitle(events, today) || job.canonical_name;
  if (!name) return { job_id: job.id, result: 'no_name' };

  // Already in ProBuild under the same name (the crew made it)? Link that one instead.
  const want = normalizeJobName(name), wantJob = normalizeJobName(job.canonical_name);
  const existing = projects.find((p) => !p.deletedAt && [want, wantJob].includes(normalizeJobName(p.name || p.title || '')));
  if (existing) {
    if (apply) await api.ProbuildProjectLink.create({ project_id: existing.id, project_name: existing.name || '', job_id: job.id, job_name: job.canonical_name });
    return { job_id: job.id, job_name: job.canonical_name, result: apply ? 'linked_existing' : 'would_link_existing', project_id: existing.id, project_name: existing.name };
  }

  if (!apply) return { job_id: job.id, job_name: job.canonical_name, result: 'would_create', project_name: name, members: members.length };
  const at = new Date().toISOString();
  const users = Object.fromEntries(members.map((m) => [m, { addedAt: at, addedBy: uid }]));
  const body = { name, status: 'lead', createdAt: at, createdBy: uid, lastModifiedAt: at, users };
  const r = await fetch(`${DB}/projects.json?auth=${idToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return { job_id: job.id, result: 'create_failed', status: r.status, detail: (await r.text()).slice(0, 300) };
  const { name: projectId } = await r.json();
  await api.ProbuildProjectLink.create({ project_id: projectId, project_name: name, job_id: job.id, job_name: job.canonical_name });
  projects.push({ id: projectId, ...body });
  return { job_id: job.id, job_name: job.canonical_name, result: 'created', project_id: projectId, project_name: name, members: members.length };
}

export default async function probuildProjects(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && !OWNERS.has(String(user.email || '').toLowerCase())) return json({ error: 'forbidden' }, 403);
    const body = await req.json().catch(() => ({}));
    const api = base44.asServiceRole.entities;
    const action = body.action || 'inspect';

    const idToken = await getProbuildIdToken(base44);
    const uid = tokenUid(idToken);
    const projects = await fetchProbuildProjects(idToken);
    const { ids: members, sample } = teamMembers(projects, uid);
    const today = denverDate();
    const ctx = { api, idToken, uid, projects, members, today };

    if (action === 'inspect') {
      const shallow = await fetch(`${DB}.json?auth=${idToken}&shallow=true`).then((r) => r.ok ? r.json() : null).catch(() => null);
      return json({
        token_user: uid, team_keys: shallow ? Object.keys(shallow) : null, project_count: projects.length,
        members, newest_project: sample ? { id: sample.id, keys: Object.keys(sample), name: sample.name, status: sample.status, createdBy: sample.createdBy, user_count: Object.keys(sample.users || {}).length } : null,
      });
    }

    if (action === 'build') {
      if (!body.job_id) return json({ error: 'job_id required' }, 400);
      return json({ ok: true, ...(await buildOne(ctx, body.job_id, body.apply === true)) });
    }

    if (action === 'sync') {
      const settings = (await api.AppSettings.list('-created_date', 1).catch(() => []))[0] || {};
      const apply = body.apply === true && settings.probuild_autobuild === true;
      const days = Math.min(Math.max(Number(body.days) || 14, 1), 45);
      const events = await fetchAllPages(api.CalendarEvents, '-event_date', 3000);
      const jobIds = [...new Set(events.filter((e) => e.job_id && e.event_date >= today && e.event_date <= addDays(today, days) && !/cancel/i.test(e.source_status || '')).map((e) => e.job_id))];
      const results = [];
      for (const id of jobIds) results.push(await buildOne(ctx, id, apply));
      return json({ ok: true, apply, autobuild_on: settings.probuild_autobuild === true, results });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (error) {
    return json({ error: String(error?.message || error).replace(/auth=[^&\s]+/g, 'auth=[redacted]') }, 200);
  }
}

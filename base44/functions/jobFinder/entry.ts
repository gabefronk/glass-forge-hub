import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { findJobs, findEvents, denverDate } from '../../shared/jobFinder.js';

// Agent-facing lookup: "where is the Oquirrh West 412 job?", "what's on tomorrow?",
// "find the Brewer visit so I can move it". Any signed-in Hub user may search;
// results carry names, addresses, dates, times and ids only (never money).
// Reads use the service role so crew logins get addresses without seeing the
// money-bearing CalendarEvents rows themselves.
const CACHE_MS = 60_000;
let cache = { at: 0, jobs: null, events: null };

async function all(entity, sort) {
  const out = [];
  for (let skip = 0; skip < 50000; skip += 1000) {
    const page = await entity.list(sort, 1000, skip);
    out.push(...page);
    if (page.length < 1000) return out;
  }
  throw new Error('pagination_limit');
}

async function load(api, fresh) {
  if (!fresh && cache.jobs && Date.now() - cache.at < CACHE_MS) return cache;
  const [jobs, events] = await Promise.all([all(api.Jobs, '-created_date'), all(api.CalendarEvents, '-event_date')]);
  cache = { at: Date.now(), jobs, events };
  return cache;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'sign_in_required' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = body.action || (body.date || body.from || body.to ? 'find_events' : 'find_job');
    const { jobs, events } = await load(base44.asServiceRole.entities, body.fresh === true);
    const today = denverDate();
    if (action === 'find_job') return Response.json(findJobs({ query: body.query, limit: Number(body.limit) || 5, today }, jobs, events));
    if (action === 'find_events') return Response.json(findEvents({ query: body.query, date: body.date, from: body.from, to: body.to, limit: Number(body.limit) || 25, today }, events));
    return Response.json({ error: 'unknown_action', detail: 'Use action find_job or find_events.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: 'lookup_failed', detail: String(error?.message || error).slice(0, 300) }, { status: 500 });
  }
}

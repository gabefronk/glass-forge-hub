// Fast job / visit lookup for agents (Instinct, MCP clients, in-app agents).
// Pure functions: the function entry loads Jobs + CalendarEvents and calls these.
// Output never carries money: no labor amounts, fee data or raw scope notes.

const STOP = new Set(['the', 'and', 'at', 'for', 'job', 'jobs', 'res', 'residence', 'lot', 'homes', 'home', 'ya', 'on', 'of', 'a', 'to', 'address', 'site', 'event', 'visit']);

export const norm = (v) => String(v ?? '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').trim();
// Calendar titles carry crew/priority prefixes ("YA - #1 (l.i.) ..."); strip them so an
// event title and a job name compare as the same job.
const PREFIX = /^(?:(?:YA|W|Wes|MDS|AP|BB|HP|SP)\s*-\s*)?(?:(?:#[1-9]\s*)|(?:\([^)]*\)\s*)){0,3}/i;
export const jobKey = (v) => norm(String(v ?? '').trim().replace(PREFIX, '')).split(' ').filter((t) => t && t !== 'res' && t !== 'residence').join(' ');
export const tokens = (v) => norm(v).split(' ').filter((t) => t && !STOP.has(t));

// Denver calendar date (YYYY-MM-DD) for "today"/"tomorrow" style inputs.
export function denverDate(offsetDays = 0, now = new Date()) {
  const d = new Date(now.getTime() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function resolveDate(v, now = new Date()) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'today') return denverDate(0, now);
  if (s === 'tomorrow') return denverDate(1, now);
  if (s === 'yesterday') return denverDate(-1, now);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// Score how well a query matches a haystack. Numbers (lot, building, PO, house number)
// must match exactly; a query number that is missing is a strong negative.
export function matchScore(query, hay) {
  const q = tokens(query);
  if (!q.length) return 0;
  const h = new Set(tokens(hay));
  const hayText = ' ' + norm(hay) + ' ';
  let hit = 0, weight = 0;
  for (const t of q) {
    const isNum = /\d/.test(t);
    const w = isNum ? 2 : 1;
    weight += w;
    if (h.has(t)) hit += w;
    else if (!isNum && t.length >= 4 && hayText.includes(' ' + t)) hit += w * 0.7; // prefix: "oquir" → "oquirrh"
  }
  return weight ? hit / weight : 0;
}

const eventHay = (e) => [e.job_name, e.address, e.source_location, e.builder, e.po_number, e.oe_number].filter(Boolean).join(' ');
const jobHay = (j) => [j.canonical_name, ...(j.aliases || []), j.address, j.builder, j.customer_name, ...(j.po_numbers || []), ...(j.oe_numbers || [])].filter(Boolean).join(' ');

export function safeEvent(e) {
  return {
    event_id: e.id,
    date: e.event_date || null,
    end_date: e.end_date || null,
    start_time: e.start_time || null,
    end_time: e.end_time || null,
    title: (e.job_name || '').trim(),
    address: e.address || e.source_location || null,
    crew: e.crew || null,
    job_id: e.job_id || null,
    calendar: e.google_calendar_id || (e.source === 'app' ? 'hub' : null),
    po_number: e.po_number || null,
    oe_number: e.oe_number || null,
    report_status: e.report_status || null,
    movable: !!(e.google_event_id && !String(e.google_event_id).startsWith('gfjobs')),
  };
}

const byDateTime = (a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')) || String(a.start_time || '').localeCompare(String(b.start_time || ''));
const live = (e) => e.source_status !== 'cancelled';

// Events that belong to a job: linked by job_id, or (for unlinked events) same
// normalized name as the job's name / aliases.
// includeCancelled: cancelled visits still carry a valid jobsite address.
export function eventsForJob(job, events, includeCancelled = false) {
  const names = new Set([job.canonical_name, ...(job.aliases || [])].map(jobKey).filter(Boolean));
  return events.filter((e) => (includeCancelled || live(e)) && (e.job_id === job.id || (!e.job_id && names.has(jobKey(e.job_name)))));
}
// "7577 S Oak Hallow Rd West Jordan" and "7577 s oak hallow rd, west jordan ut" -> same key.
const addressKey = (a) => { const t = norm(a).split(' '); return /^\d/.test(t[0] || '') && t.length >= 3 ? t.slice(0, 3).join(' ') : ''; };

export function findJobs({ query, limit = 5, today }, jobs, events) {
  const q = String(query || '').trim();
  if (!q) return { error: 'query_required', detail: 'Pass a job name, address, lot, PO or OE number.' };
  const scored = [];
  for (const j of jobs) {
    const s = matchScore(q, jobHay(j));
    if (s >= 0.6) scored.push({ job: j, score: s });
  }
  // Also match on calendar events: many events carry the address the Job record lacks.
  const evHits = new Map();
  for (const e of events) {
    if (!live(e)) continue;
    const s = matchScore(q, eventHay(e));
    if (s >= 0.6) {
      const key = e.job_id || 'name:' + jobKey(e.job_name);
      const prev = evHits.get(key);
      if (!prev || s > prev.score) evHits.set(key, { event: e, score: s });
    }
  }
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  for (const [key, { event, score }] of evHits) {
    if (key.startsWith('name:')) {
      const j = jobs.find((x) => [x.canonical_name, ...(x.aliases || [])].some((n) => jobKey(n) === key.slice(5)));
      if (j && !scored.some((s) => s.job?.id === j.id)) scored.push({ job: j, score });
      else if (j) continue;
      else if (!j) scored.push({ job: null, event, score });
    } else if (jobById.has(key) && !scored.some((s) => s.job?.id === key)) {
      scored.push({ job: jobById.get(key), score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const summaries = scored.slice(0, limit * 4).map(({ job, event, score }) => {
    if (!job) {
      const evs = events.filter((e) => !e.job_id && jobKey(e.job_name) === jobKey(event.job_name)).sort(byDateTime);
      return summarize(null, evs, score, today, event);
    }
    return summarize(job, eventsForJob(job, events, true).sort(byDateTime), score, today);
  });
  // Duplicate Job records / differently-titled visits at the same jobsite collapse into
  // one result so the agent gets a single answer instead of three near-identical ones.
  const groups = new Map();
  for (const r of summaries) {
    const key = addressKey(r.address) || 'name:' + jobKey(r.name).replace(/\b(reorder|add|change)\b/g, '').trim();
    const g = groups.get(key);
    if (!g) { groups.set(key, { ...r, job_ids: r.job_id ? [r.job_id] : [], also_named: [] }); continue; }
    if (r.job_id && !g.job_ids.includes(r.job_id)) g.job_ids.push(r.job_id);
    if (norm(r.name) !== norm(g.name) && !g.also_named.includes(r.name)) g.also_named.push(r.name);
    const seen = new Set([...g.next_visits, ...g.recent_visits].map((v) => v.event_id));
    g.next_visits = [...g.next_visits, ...r.next_visits.filter((v) => !seen.has(v.event_id))].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5);
    g.recent_visits = [...g.recent_visits, ...r.recent_visits.filter((v) => !seen.has(v.event_id))].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3);
    if (!g.job_id && r.job_id) { g.job_id = r.job_id; g.hub_url = r.hub_url; }
    if (!g.address && r.address) g.address = r.address;
  }
  const results = [...groups.values()].slice(0, limit);
  return {
    query: q,
    results,
    ambiguous: results.length > 1 && results[0].match_score - results[1].match_score < 0.15,
  };
}

function summarize(job, evs, score, today, fallbackEvent) {
  const upcoming = evs.filter((e) => live(e) && (e.event_date || '') >= today);
  const past = evs.filter((e) => live(e) && (e.event_date || '') < today).reverse();
  const withAddr = [...evs].reverse().find((e) => e.address || e.source_location);
  const address = job?.address || withAddr?.address || withAddr?.source_location || fallbackEvent?.address || null;
  return {
    job_id: job?.id || null,
    name: job?.canonical_name || (fallbackEvent?.job_name || '').trim(),
    builder: job?.builder || null,
    address,
    address_source: job?.address ? 'job' : address ? 'calendar_event' : null,
    po_numbers: job?.po_numbers || [],
    oe_numbers: job?.oe_numbers || [],
    next_visits: upcoming.slice(0, 5).map(safeEvent),
    recent_visits: past.slice(0, 3).map(safeEvent),
    match_score: Math.round(score * 100) / 100,
    hub_url: job?.id ? `/jobs/${job.id}` : null,
  };
}

export function findEvents({ query, date, from, to, limit = 25, today }, events) {
  const d = resolveDate(date);
  const lo = d || resolveDate(from) || (query ? '' : today);
  const hi = d || resolveDate(to) || (query ? '' : today);
  const q = String(query || '').trim();
  let rows = events.filter((e) => live(e) && (!lo || (e.event_date || '') >= lo) && (!hi || (e.event_date || '') <= hi));
  if (q) rows = rows.map((e) => ({ e, s: matchScore(q, eventHay(e)) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s || byDateTime(a.e, b.e)).map((x) => x.e);
  else rows.sort(byDateTime);
  // With a text query and no dates, prefer upcoming visits, then most recent.
  if (q && !lo && !hi) {
    const up = rows.filter((e) => (e.event_date || '') >= today).sort(byDateTime);
    const past = rows.filter((e) => (e.event_date || '') < today).sort((a, b) => byDateTime(b, a));
    rows = [...up, ...past];
  }
  return { query: q || null, from: lo || null, to: hi || null, count: rows.length, events: rows.slice(0, Math.min(100, limit)).map(safeEvent) };
}

// Confident-link plan for the Unlinked Records page ("Check confident links" / "Link them").
// Additive only: a billing line, calendar event or field report with no job is linked when
// every piece of evidence found names the same live job. Records that already have a job are
// never touched. Pure, so it runs in tests and in the repairJobLinks function.
//
// Evidence that can link a record on its own:
//   - a high-confidence billing line for the same calendar event / ProBuild post
//   - (billing lines) the calendar event or field report it came from has a job
//   - a ProBuild project link (ProbuildProjectLink) to one job
//   - a PO or OE number on exactly one job, unless the title's lot/community disagrees
//   - the cleaned name equals exactly one job's name or alias AND the billing lines already
//     linked under that cleaned name all sit on that job
// Any disagreement (two jobs, a name that points elsewhere, earlier lines split across jobs)
// skips the record and counts it as ambiguous.
import { followMergedJobId } from './jobLinkResolver.js';
import { lotCommunityCheck } from './lotCommunityMatch.js';

const PREFIX = /^(ready|done|pickup|delivery|eta|tentative)\s*:?\s*-?\s*/i;

// "YA - #1 (l.i) (2 techs) Holmes Homes - 202 Deer Springs" -> "holmes homes 202 deer springs"
export function cleanJobName(name) {
  let s = String(name || '').toLowerCase().trim().replace(PREFIX, '');
  s = s.replace(/^(ya|i|w)\s*[-–—]\s*/, '');
  s = s.replace(/#\s*\d+/g, ' ').replace(/\([^)]*\)/g, ' ');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

const exactId = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const add = (map, key, value) => { if (!key || !value) return; const s = map.get(key) || new Set(); s.add(value); map.set(key, s); };

export function planUnlinkedLinks({ jobs = [], fees = [], events = [], reports = [], projectLinks = [] } = {}) {
  const live = new Map(jobs.filter((j) => j && !j.merged_into && !j.is_sample).map((j) => [j.id, j]));
  const follow = (id) => followMergedJobId(jobs, id);
  const liveJob = (id) => { const j = follow(id); return live.has(j) ? j : null; };

  const byPo = new Map(), byOe = new Map(), byName = new Map();
  for (const j of jobs) {
    for (const v of j.po_numbers || []) add(byPo, exactId(v), j.id);
    for (const v of j.oe_numbers || []) add(byOe, exactId(v), j.id);
  }
  for (const j of live.values()) for (const n of [j.canonical_name, ...(j.aliases || [])]) add(byName, cleanJobName(n), j.id);
  const byProject = new Map();
  for (const l of projectLinks) if (!l.source_deleted) add(byProject, l.project_id, l.job_id);
  const eventJob = new Map(events.filter((e) => e.job_id).map((e) => [e.google_event_id, e.job_id]));
  const reportJob = new Map(reports.filter((r) => r.job_id).map((r) => [r.post_id, r.job_id]));

  const byEvent = new Map(), byPost = new Map(), precedent = new Map();
  const noteLinkedFee = (f) => {
    if (f.match_confidence === 'high' && !f.superseded_by) {
      add(byEvent, f.calendar_event_id, f.job_id);
      add(byPost, f.probuild_post_id, f.job_id);
    }
    add(precedent, cleanJobName(f.job_name_raw), liveJob(f.job_id) || f.job_id);
  };
  for (const f of fees) if (f.job_id) noteLinkedFee(f);

  let ambiguous = 0;
  // Returns the one live job every piece of evidence agrees on, or null.
  const decide = (row) => {
    const found = new Set();
    let conflict = false;
    const take = (ids) => {
      const set = new Set([...(ids || [])].map(liveJob).filter(Boolean));
      if (set.size > 1) conflict = true;
      for (const j of set) found.add(j);
    };
    const hard = (ids) => {
      const set = new Set([...(ids || [])].map(liveJob).filter(Boolean));
      if (set.size !== 1) { if (set.size > 1) conflict = true; return; }
      const [j] = set;
      if (row.name && lotCommunityCheck(row.name, live.get(j)).veto) { conflict = true; return; }
      found.add(j);
    };
    take(row.event_key && byEvent.get(row.event_key));
    take(row.post_key && byPost.get(row.post_key));
    take(row.source_jobs);
    take(row.project_id && byProject.get(row.project_id));
    if (row.po) hard(byPo.get(exactId(row.po)));
    if (row.oe) hard(byOe.get(exactId(row.oe)));
    const key = cleanJobName(row.name);
    const named = key ? byName.get(key) : null;
    const prior = key ? precedent.get(key) : null;
    if (named && named.size === 1) {
      const [j] = named;
      if (prior && prior.size === 1 && prior.has(j)) found.add(j);
      else if (prior && prior.size) conflict = true;
      else if (found.size && !found.has(j)) conflict = true;
    } else if (prior && prior.size > 1 && found.size) conflict = true;
    if (conflict || found.size > 1) { if (found.size) ambiguous++; return null; }
    return found.size === 1 ? [...found][0] : null;
  };

  const feeLines = [];
  for (const f of fees) {
    if (f.job_id || f.superseded_by || f.billed_to_bfs) continue;
    const source = [eventJob.get(f.calendar_event_id), reportJob.get(f.probuild_post_id)].filter(Boolean);
    const job = decide({ name: f.job_name_raw, po: f.po_number, oe: f.oe_number, event_key: f.calendar_event_id, post_key: f.probuild_post_id, project_id: f.probuild_project_id, source_jobs: source });
    if (!job) continue;
    // Same rule as ingest (mergeReviewFlags): the job hold clears; a pricing or service
    // review keeps the line held. A line that was not held is never put on hold.
    feeLines.push({ id: f.id, job_id: job, match_confidence: 'high', needs_review: !!f.needs_review && (!!f.pricing_review_reason || f.service_review_status === 'review') });
  }
  // Lines linked in this plan count as evidence for their event / report.
  for (const p of feeLines) noteLinkedFee({ ...fees.find((f) => f.id === p.id), job_id: p.job_id, match_confidence: 'high' });

  const calendarEvents = events.filter((e) => !e.job_id).flatMap((e) => {
    const job = decide({ name: e.job_name, po: e.po_number, oe: e.oe_number, event_key: e.google_event_id });
    return job ? [{ id: e.id, job_id: job }] : [];
  });
  const fieldReports = reports.filter((r) => !r.job_id).flatMap((r) => {
    const job = decide({ name: r.job_name, post_key: r.post_id, project_id: r.project_id });
    return job ? [{ id: r.id, job_id: job }] : [];
  });
  return { fee_lines: feeLines, calendar_events: calendarEvents, field_reports: fieldReports, skipped_ambiguous: ambiguous };
}

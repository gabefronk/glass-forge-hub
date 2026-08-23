import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeJobName, matchJob, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, mergeReviewFlags } from '../../shared/ingestShared.ts';
import { countAttachments } from '../../shared/reportMatching.ts';
import { toMs, getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject, filterProjectsByWindow } from '../../shared/probuildApi.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Ingest Probuild posts into FeeLines + FieldReports. One row per post.
// Auth: Firebase refresh-token exchange (rotated token persisted to ProbuildAuth).
// Data: Firebase RTDB. Projects filtered by lastModifiedAt within 21-day window
// (no deletedAt). Posts fetched per-project, createdAt converted UTC → America/Denver
// before deriving job_date. LLM extracts man_hours/trip_charges from the verbatim
// note (never inferred). Upserts on probuild_post_id; never overwrites a
// manually_adjusted row.
//
// The pull window extends through TODAY (not yesterday) so that D+1 posts
// (crew posts the morning after the job) are always captured.
const DB_BASE = 'https://probuild-prod.firebaseio.com';
const TEAM_ID = '-O7aXXhvthc41u60Koc6';

function toDenverDateString(utcIso) {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d); // YYYY-MM-DD
}

// Find an existing calendar-sourced FeeLine for the same job within ±3 days
// that hasn't already been merged with a Probuild post and has no man_hours yet.
function findCalendarRowToMerge(existingFees, jobId, postDate) {
  if (!jobId || !postDate) return null;
  const postMs = new Date(postDate + 'T00:00:00Z').getTime();
  let best = null;
  let minDiff = Infinity;
  for (const f of existingFees) {
    if (f.job_id !== jobId) continue;
    if (f.source !== 'calendar') continue;
    if (f.manually_adjusted) continue;
    if (f.probuild_post_id) continue;
    if (f.man_hours != null) continue;
    const diff = Math.abs(new Date(f.job_date + 'T00:00:00Z').getTime() - postMs);
    if (diff <= 3 * 86400000 && diff < minDiff) {
      minDiff = diff;
      best = f;
    }
  }
  return best;
}

function extractPhotoUrls(post) {
  if (!post) return [];
  for (const key of ['attachments', 'photos', 'media', 'images', 'files']) {
    const val = post[key];
    if (Array.isArray(val)) {
      return val.map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.url || item.uri || item.src || item.link || '';
      }).filter(Boolean);
    }
    if (val && typeof val === 'object') {
      return Object.values(val).map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.url || item.uri || item.src || item.link || '';
      }).filter(Boolean);
    }
  }
  return [];
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    // Window extends through TODAY so D+1 posts are always captured.
    const endStr = body.end_date || today.toISOString().slice(0, 10);
    // Widen project scan from 14 to 21 days to reduce silent misses.
    const startStr = body.start_date || new Date(today.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Auth — exchange refresh token (shared module)
    const idToken = await getProbuildIdToken(base44);

    // 2. Fetch + filter projects (shared module)
    const projectEntries = await fetchProbuildProjects(idToken);
    const windowStartMs = new Date(startStr + 'T00:00:00Z').getTime();
    const windowEndMs = new Date(endStr + 'T23:59:59Z').getTime();
    const { qualifying, stats: projectStats } = filterProjectsByWindow(projectEntries, windowStartMs, windowEndMs);

    // 3. Fetch posts per qualifying project (parallel)
    const postResults = await Promise.all(qualifying.map(async (p) => {
      const posts = await fetchProbuildPostsForProject(idToken, p.id);
      return posts.map(post => ({ ...post, projectName: p.name || p.title || '' }));
    }));
    const allPosts = postResults.flat();

    // 4. Filter posts by Denver-derived job_date within window
    const inWindowPosts = [];
    for (const item of allPosts) {
      const createdIso = item.post.createdAt;
      if (!createdIso) continue;
      const jobDate = toDenverDateString(createdIso);
      if (!jobDate) continue;
      if (jobDate < startStr || jobDate > endStr) continue;
      inWindowPosts.push({ ...item, jobDate });
    }

    // 5. LLM extraction (batched)
    const extractionMap = new Map();
    const BATCH = 25;
    for (let i = 0; i < inWindowPosts.length; i += BATCH) {
      const batch = inWindowPosts.slice(i, i + BATCH);
      const promptInputs = batch.map((b) => ({ post_id: b.postId, message: b.post.message || '' }));
      const prompt = `Extract structured data from short, typo-heavy construction work notes. For each post return man_hours, trip_charges, needs_review.
- man_hours: the number stated beside "man hour" or "man hours". If not explicitly stated, null.
- trip_charges: the count of trip charges stated (e.g. "2 trip charges" -> 2; a single "trip charge" -> 1). If not stated, null.
- needs_review: true if any value is ambiguous or had to be inferred rather than read directly.
NEVER infer hours from the work described, photo count, or job duration. Only extract explicitly stated numbers. Return a JSON object with a "results" array, one entry per post_id, in the same order as the input.

Posts:
${JSON.stringify(promptInputs)}`;
      const resp = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  post_id: { type: 'string' },
                  man_hours: { type: ['number', 'null'] },
                  trip_charges: { type: ['number', 'null'] },
                  needs_review: { type: 'boolean' }
                },
                required: ['post_id', 'needs_review']
              }
            }
          },
          required: ['results']
        }
      });
      const results = (resp && resp.results) || [];
      for (const r of results) extractionMap.set(r.post_id, r);
    }

    // 6. Jobs: match, auto-create missing
    const jobsArr = await fetchAllPages(base44.asServiceRole.entities.Jobs, '-created_date', 1000);
    const matched = inWindowPosts.map((b) => {
      const normName = normalizeJobName(b.projectName);
      const m = matchJob(normName, jobsArr);
      return { b, normName, m };
    });
    const autoCreateNames = [...new Set(matched.filter((x) => x.m.autoCreate).map((x) => x.normName).filter(Boolean))];
    const newJobs = autoCreateNames.length
      ? await base44.asServiceRole.entities.Jobs.bulkCreate(autoCreateNames.map((n) => ({ canonical_name: n, aliases: [n] })))
      : [];
    const jobByNorm = new Map();
    for (const j of newJobs) jobByNorm.set(j.canonical_name, j);
    for (const j of jobsArr) { const n = normalizeJobName(j.canonical_name); if (n) jobByNorm.set(n, j); }

    // 7. Build FeeLines rows + upsert on probuild_post_id
    const existingFees = await fetchAllPages(base44.asServiceRole.entities.FeeLines, '-created_date', 1000);
    const existingByPostId = new Map();
    for (const f of existingFees) if (f.probuild_post_id) existingByPostId.set(f.probuild_post_id, f);

    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
    let merged_count = 0;
    const flagged = [];
    const phillipGrover = [];
    for (const { b, normName, m } of matched) {
      const post = b.post;
      const ext = extractionMap.get(b.postId) || { needs_review: true };
      let jobId = m.job_id;
      if (m.autoCreate) jobId = jobByNorm.get(normName)?.id || null;
      const row = {
        job_id: jobId,
        job_date: b.jobDate,
        invoice_month: invoiceMonthFromDate(b.jobDate),
        job_name_raw: b.projectName,
        job_name_norm: normName,
        line_description: (post.message || '').slice(0, 150),
        probuild_project_id: b.projectId,
        probuild_post_id: b.postId,
        note_text: post.message || '',
        man_hours: ext.man_hours != null ? Number(ext.man_hours) : null,
        trip_charges: ext.trip_charges != null ? Number(ext.trip_charges) : null,
        photo_urls: [],
        fee_pct: 0.1,
        billable: true,
        source: 'probuild',
        written_by: 'probuild',
        match_confidence: m.match_confidence,
        needs_review: !!(m.needs_review || ext.needs_review),
        manually_adjusted: false,
      };
      row.labor_amt = computeLaborAmt(row);
      row.fee_amt = computeFeeAmt(row);
      const ex = existingByPostId.get(b.postId);
      if (ex) {
        if (ex.manually_adjusted) { skipped++; continue; }
        const merged = mergeReviewFlags(ex, row);
        toUpdate.push({ id: ex.id, ...row, needs_review: merged.needs_review, match_confidence: merged.match_confidence });
      } else {
        const calRow = findCalendarRowToMerge(existingFees, jobId, b.jobDate);
        if (calRow) {
          const mergedRow = { ...calRow, man_hours: row.man_hours, trip_charges: row.trip_charges, source: 'both' };
          mergedRow.labor_amt = computeLaborAmt(mergedRow);
          mergedRow.fee_amt = computeFeeAmt(mergedRow);
          const merged = mergeReviewFlags(calRow, { job_id: jobId, needs_review: row.needs_review });
          toUpdate.push({
            id: calRow.id,
            source: 'both',
            man_hours: row.man_hours,
            trip_charges: row.trip_charges,
            probuild_post_id: b.postId,
            probuild_project_id: b.projectId,
            labor_amt: mergedRow.labor_amt,
            fee_amt: mergedRow.fee_amt,
            needs_review: merged.needs_review,
            match_confidence: merged.match_confidence,
          });
          merged_count++;
        } else {
          toCreate.push(row);
        }
      }
      if (row.needs_review) flagged.push({ post_id: b.postId, job_date: b.jobDate, job_name: b.projectName });
      if (/phillip grover/i.test(b.projectName) || /phillip grover/i.test(post.message || '')) {
        phillipGrover.push({ post_id: b.postId, job_date: b.jobDate, created_utc: post.createdAt, job_name: b.projectName });
      }
    }
    if (toCreate.length) await base44.asServiceRole.entities.FeeLines.bulkCreate(toCreate);
    if (toUpdate.length) await base44.asServiceRole.entities.FeeLines.bulkUpdate(toUpdate);

    // 8. Write FieldReports (upsert on post_id)
    const existingReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-created_date', 1000);
    const reportByPostId = new Map();
    for (const r of existingReports) if (r.post_id) reportByPostId.set(r.post_id, r);
    const frToCreate = [];
    const frToUpdate = [];
    for (const { b, normName, m } of matched) {
      const post = b.post;
      const ext = extractionMap.get(b.postId) || { needs_review: true };
      const reportRow = {
        job_date: b.jobDate,
        job_name: b.projectName,
        message: post.message || '',
        photo_urls: extractPhotoUrls(post),
        attachment_count: countAttachments(post.attachments),
        post_id: b.postId,
        project_id: b.projectId,
        created_at: post.createdAt || null,
        man_hours: ext.man_hours != null ? Number(ext.man_hours) : null,
        trip_charges: ext.trip_charges != null ? Number(ext.trip_charges) : null,
      };
      const exRep = reportByPostId.get(b.postId);
      if (exRep) frToUpdate.push({ id: exRep.id, ...reportRow });
      else frToCreate.push(reportRow);
    }
    if (frToCreate.length) await base44.asServiceRole.entities.FieldReports.bulkCreate(frToCreate);
    if (frToUpdate.length) await base44.asServiceRole.entities.FieldReports.bulkUpdate(frToUpdate);

    return Response.json({
      source: 'probuild',
      window: { start_date: startStr, end_date: endStr },
      project_scan: projectStats,
      projects_qualifying: qualifying.length,
      posts_fetched: allPosts.length,
      posts_in_window: inWindowPosts.length,
      created: toCreate.length,
      updated: toUpdate.length,
      merged_into_calendar: merged_count,
      skipped_manually_adjusted: skipped,
      auto_created_jobs: autoCreateNames,
      flagged_for_review: flagged,
      phillip_grover_rows: phillipGrover,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { normalizeJobName, matchJob, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, mergeReviewFlags } from '../../shared/ingestShared.ts';

// Ingest Probuild posts into FeeLines. One row per post.
// Auth: Firebase refresh-token exchange (rotated token persisted to ProbuildAuth).
// Data: Firebase RTDB. Projects filtered by lastModifiedAt in window (no deletedAt),
// posts fetched per-project (no global post query — blocked), createdAt converted
// UTC -> America/Denver before deriving job_date. LLM extracts man_hours/trip_charges
// from the verbatim note (never inferred). Upserts on probuild_post_id; never
// overwrites a manually_adjusted row.
const FIREBASE_API_KEY = 'AIzaSyD-bRl-_9tZLccN3HQ9IMy27pY37VKY1xc';
const FIREBASE_TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const DB_BASE = 'https://probuild-prod.firebaseio.com';
const TEAM_ID = '-O7aXXhvthc41u60Koc6';

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

function toDenverDateString(utcIso) {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d); // YYYY-MM-DD
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    const endStr = body.end_date || today.toISOString().slice(0, 10);
    const startStr = body.start_date || new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Current refresh token (ProbuildAuth first, secret fallback)
    const authRecords = await base44.asServiceRole.entities.ProbuildAuth.list('-updated_date', 1);
    let refreshToken = authRecords.length > 0 ? authRecords[0].refresh_token : secrets.get('PROBUILD_REFRESH_TOKEN');
    if (!refreshToken) return Response.json({ error: 'no_refresh_token' }, { status: 200 });

    // 2. Exchange refresh token
    const tokenRes = await fetch(FIREBASE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://portal.probuild.app/',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    if (tokenRes.status === 401) {
      return Response.json({ error: 'probuild_auth_401', detail: 'Refresh token rejected (401). Capture a fresh Probuild refresh token and update PROBUILD_REFRESH_TOKEN / ProbuildAuth.' }, { status: 200 });
    }
    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      return Response.json({ error: 'probuild_auth_failed', status: tokenRes.status, detail: txt }, { status: 200 });
    }
    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token;
    const rotatedRefreshToken = tokenData.refresh_token;

    // 3. Persist rotated refresh token
    const nowIso = new Date().toISOString();
    if (authRecords.length > 0) {
      await base44.asServiceRole.entities.ProbuildAuth.update(authRecords[0].id, { refresh_token: rotatedRefreshToken, last_exchanged_at: nowIso });
    } else {
      await base44.asServiceRole.entities.ProbuildAuth.create({ refresh_token: rotatedRefreshToken, last_exchanged_at: nowIso });
    }

    // 4. Fetch projects
    const projectsRes = await fetch(`${DB_BASE}/teams/${TEAM_ID}/projects.json?auth=${idToken}`);
    if (!projectsRes.ok) {
      const txt = await projectsRes.text();
      return Response.json({ error: 'projects_fetch_failed', status: projectsRes.status, detail: txt }, { status: 200 });
    }
    const projectsJson = await projectsRes.json();
    const projectEntries = [];
    if (Array.isArray(projectsJson)) {
      projectsJson.forEach((p, i) => { if (p) projectEntries.push({ id: String(i), ...p }); });
    } else {
      for (const [pid, p] of Object.entries(projectsJson || {})) { if (p) projectEntries.push({ id: pid, ...p }); }
    }

    // 5. Filter projects: no deletedAt AND lastModifiedAt within window (anchored to start_date)
    const windowStartMs = new Date(startStr + 'T00:00:00Z').getTime();
    const windowEndMs = new Date(endStr + 'T23:59:59Z').getTime();
    const qualifying = [];
    for (const p of projectEntries) {
      if (p.deletedAt) continue;
      const lm = toMs(p.lastModifiedAt);
      if (lm == null) continue;
      if (lm >= windowStartMs && lm <= windowEndMs) qualifying.push(p);
    }

    // 6. Fetch posts per qualifying project (parallel)
    const postResults = await Promise.all(qualifying.map(async (p) => {
      try {
        const r = await fetch(`${DB_BASE}/teams/${TEAM_ID}/posts/${p.id}.json?auth=${idToken}`);
        if (!r.ok) return [];
        const j = await r.json();
        if (!j) return [];
        const out = [];
        for (const [postId, post] of Object.entries(j)) {
          if (!post) continue;
          out.push({ projectId: p.id, projectName: p.name || p.title || '', postId, post });
        }
        return out;
      } catch { return []; }
    }));
    const allPosts = postResults.flat();

    // 7. Filter posts by Denver-derived job_date within window
    const inWindowPosts = [];
    for (const item of allPosts) {
      const createdIso = item.post.createdAt;
      if (!createdIso) continue;
      const jobDate = toDenverDateString(createdIso);
      if (!jobDate) continue;
      if (jobDate < startStr || jobDate > endStr) continue;
      inWindowPosts.push({ ...item, jobDate });
    }

    // 8. LLM extraction (the only place an LLM is used), batched
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

    // 9. Jobs: match, auto-create missing
    const jobsArr = await base44.asServiceRole.entities.Jobs.list('-created_date', 500);
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

    // 10. Build rows + upsert on probuild_post_id
    const existingFees = await base44.asServiceRole.entities.FeeLines.list('-created_date', 1000);
    const existingByPostId = new Map();
    for (const f of existingFees) if (f.probuild_post_id) existingByPostId.set(f.probuild_post_id, f);

    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
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
        toCreate.push(row);
      }
      if (row.needs_review) flagged.push({ post_id: b.postId, job_date: b.jobDate, job_name: b.projectName });
      if (/phillip grover/i.test(b.projectName) || /phillip grover/i.test(post.message || '')) {
        phillipGrover.push({ post_id: b.postId, job_date: b.jobDate, created_utc: post.createdAt, job_name: b.projectName });
      }
    }
    if (toCreate.length) await base44.asServiceRole.entities.FeeLines.bulkCreate(toCreate);
    if (toUpdate.length) await base44.asServiceRole.entities.FeeLines.bulkUpdate(toUpdate);

    return Response.json({
      source: 'probuild',
      window: { start_date: startStr, end_date: endStr },
      projects_total: projectEntries.length,
      projects_qualifying: qualifying.length,
      posts_fetched: allPosts.length,
      posts_in_window: inWindowPosts.length,
      created: toCreate.length,
      updated: toUpdate.length,
      skipped_manually_adjusted: skipped,
      auto_created_jobs: autoCreateNames,
      flagged_for_review: flagged,
      phillip_grover_rows: phillipGrover,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}
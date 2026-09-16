import { extractExplicitService, extractPhotoUrls, canonicalPostRows, denverDate } from "../../shared/billingCore.js";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeJobName, matchJob, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, mergeReviewFlags } from '../../shared/ingestShared.ts';
import { countAttachments } from '../../shared/reportMatching.ts';
import { toMs, getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject, filterProjectsByWindow } from '../../shared/probuildApi.ts';
import { fetchAllPages } from '../../shared/pagination.ts';
import { parseServiceBilling } from '../../shared/serviceBilling.ts';

// Ingest Probuild posts into FeeLines + FieldReports. One row per post.
// Auth: Firebase refresh-token exchange (rotated token persisted to ProbuildAuth).
// Data: Firebase RTDB. Projects filtered by lastModifiedAt within 21-day window
// (no deletedAt). Posts fetched per-project, createdAt converted UTC → America/Denver
// before deriving job_date. LLM extracts man_hours/trip_charges from the verbatim
// note (never inferred). Upserts on probuild_post_id; never overwrites a
// manually_adjusted row. photo_urls are merged, never wiped: existing archived
// URLs survive re-syncs, and posts with attachments but no URLs get their bytes
// archived into Base44 file storage (no ProBuild link dependency).
//
// The pull window extends through TODAY (not yesterday) so that D+1 posts
// (crew posts the morning after the job) are always captured.
const DB_BASE = 'https://probuild-prod.firebaseio.com';
const TEAM_ID = '-O7aXXhvthc41u60Koc6';
const STORAGE_BUCKET = 'https://firebasestorage.googleapis.com/v0/b/probuild-prod.appspot.com/o/';

function toDenverDateString(utcIso) {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d); // YYYY-MM-DD
}


// Photo archiving: download original attachment bytes from Firebase Storage
// (same layout as the official web client's FileReference.PostAttachments) and
// store them in Base44 file storage, so the Hub never depends on ProBuild links.
async function downloadAttachment(idToken, projectId, postId, attachmentId, attachment) {
  const generation = String(attachment?.generation || '');
  const path = `teams/${TEAM_ID}/posts/${projectId}/${postId}/attachments/${attachmentId}`;
  const url = STORAGE_BUCKET + encodeURIComponent(path) + '?alt=media' + (generation ? '&generation=' + encodeURIComponent(generation) : '');
  const res = await fetch(url, { headers: { Authorization: 'Firebase ' + idToken } });
  if (!res.ok) return null;
  const mime = res.headers.get('content-type') || attachment?.mimeType || 'image/jpeg';
  if (/text\/html|application\/json/.test(mime)) return null;
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) return null;
  const name = attachment?.fileMetadata?.name || `${attachmentId}.${mime.includes('png') ? 'png' : 'jpg'}`;
  return { buf, mime, name };
}

async function archivePostPhotos(base44, idToken, projectId, postId, attachments) {
  const urls = [];
  for (const [attId, att] of Object.entries(attachments || {})) {
    if (!att || !['photo', 'file'].includes(att.type)) continue;
    try {
      const dl = await downloadAttachment(idToken, projectId, postId, attId, att);
      if (!dl) continue;
      const file = new File([dl.buf], dl.name, { type: dl.mime });
      const up = await base44.asServiceRole.integrations.Core.UploadFile({ file });
      if (up?.file_url) urls.push(up.file_url);
    } catch (e) {
      // A single photo failure must not fail the whole pull.
    }
  }
  return urls;
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
    if (f.manually_adjusted || f.billed_to_bfs || f.superseded_by || f._mergeReserved) continue;
    if (f.calendar_labor_amt != null && f.calendar_labor_amt !== '') continue;
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

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    // Window extends through TODAY so D+1 posts are always captured.
    const endStr = body.end_date || denverDate(today);
    // Widen project scan from 14 to 21 days to reduce silent misses.
    const startStr = body.start_date || denverDate(today).slice(0, 7) + '-01';

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

    // Parse only explicit quantities; ambiguous notes stay in review.
    const extractionMap = new Map(inWindowPosts.map(b => [b.postId, extractExplicitService(b.post.message || '')]));

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

    // 8. Write FieldReports (upsert on post_id)
    const existingReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-created_date', 1000);
    const reportByPostId = new Map();
    for (const r of existingReports) if (r.post_id) reportByPostId.set(r.post_id, r);
    const frToCreate = [];
    const frToUpdate = [];
    let frSkippedExisting = 0;
    let frPhotosFilled = 0;
    const photoUrlByPost = new Map();
    for (const { b, normName, m } of matched) {
      const post = b.post;
      const ext = extractionMap.get(b.postId) || { needs_review: true };
      const exRep = reportByPostId.get(b.postId);
      const extractedPhotos = extractPhotoUrls(post);
      // Merge, never wipe: keep previously archived photo_urls when the source
      // extraction has none. Archive bytes into Base44 storage only when we have
      // no URLs at all, so re-syncs never depend on ProBuild links again.
      let photoUrls = extractedPhotos.length ? extractedPhotos : (exRep?.photo_urls || []);
      if (!photoUrls.length && countAttachments(post.attachments) > 0) {
        photoUrls = await archivePostPhotos(base44, idToken, b.projectId, b.postId, post.attachments);
      }
      photoUrlByPost.set(b.postId, photoUrls);
      const reportRow = {
        job_date: b.jobDate,
        job_name: b.projectName,
        message: post.message || '',
        photo_urls: photoUrls,
        attachment_count: countAttachments(post.attachments),
        post_id: b.postId,
        project_id: b.projectId,
        created_at: post.createdAt || null,
        man_hours: ext.man_hours != null ? Number(ext.man_hours) : null,
        trip_charges: ext.trip_charges != null ? Number(ext.trip_charges) : null,
      };
      if (exRep) {
        // Append-only (Gabriel 2026-09-15): never overwrite an existing field report.
        // The only permitted write is additive: fill photo_urls when the report has none.
        if (!(exRep.photo_urls || []).length && photoUrls.length) {
          frToUpdate.push({ id: exRep.id, photo_urls: photoUrls });
          frPhotosFilled++;
        } else {
          frSkippedExisting++;
        }
      }
      else frToCreate.push(reportRow);
    }
    if (frToCreate.length) await base44.asServiceRole.entities.FieldReports.bulkCreate(frToCreate);
    if (frToUpdate.length) await base44.asServiceRole.entities.FieldReports.bulkUpdate(frToUpdate);


    // 7. Build FeeLines rows + upsert on probuild_post_id
    const existingFees = await fetchAllPages(base44.asServiceRole.entities.FeeLines, '-created_date', 1000);
    const existingByPostId = canonicalPostRows(existingFees);
    const lockedMonths = new Set(existingFees.filter(f => f.source === 'sheet-import').map(f => f.invoice_month));
    for (const snap of await fetchAllPages(base44.asServiceRole.entities.MonthCloseSnapshot, '-created_date', 1000)) lockedMonths.add(snap.month);

    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
    let merged_count = 0;
    let feePhotosFilled = 0;
    const flagged = [];
    const phillipGrover = [];
    for (const { b, normName, m } of matched) {
      const post = b.post;
      const ext = extractionMap.get(b.postId) || { needs_review: true };
      let jobId = m.job_id;
      if (m.autoCreate) jobId = jobByNorm.get(normName)?.id || null;
      const service = parseServiceBilling(post.message || '', ext.man_hours, ext.trip_charges);
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
        probuild_note_text: post.message || '',
        probuild_job_date: b.jobDate,
        pricing_review_reason: ext.reason || service.reason || null,
        man_hours: ext.man_hours != null ? Number(ext.man_hours) : null,
        trip_charges: ext.trip_charges != null ? Number(ext.trip_charges) : null,
        photo_urls: photoUrlByPost.get(b.postId) || [],
        fee_pct: 0.1,
        billable: true,
        source: 'probuild',
        written_by: 'probuild',
        match_confidence: m.match_confidence,
        needs_review: !!(m.needs_review || ext.needs_review || service.review),
        manually_adjusted: false,
        service_material: service.material || null,
        service_rate: service.rate || null,
        service_labor_amount: service.labor || null,
        service_trip_amount: service.trip || null,
        service_total: service.total || null,
        service_calculation_source: service.source || service.reason || null,
        service_review_status: service.review ? 'review' : 'ready',
      };
      row.labor_amt = computeLaborAmt(row);
      row.fee_amt = computeFeeAmt(row);
      const ex = existingByPostId.get(b.postId);
      if (ex) {
        // Append-only (Gabriel 2026-09-15): an existing fee line is never overwritten.
        // Only permitted write: additive photo_urls fill when the line has none.
        if (!(ex.photo_urls || []).length && (row.photo_urls || []).length) {
          toUpdate.push({ id: ex.id, photo_urls: row.photo_urls });
          feePhotosFilled++;
        } else {
          skipped++;
        }
        continue;
      } else {
        if (lockedMonths.has(row.invoice_month)) { skipped++; continue; }
        const calRow = findCalendarRowToMerge(existingFees.filter(f => !lockedMonths.has(f.invoice_month)), jobId, b.jobDate);
        if (calRow) {
          // Append-only (Gabriel 2026-09-15): a matching calendar row is already tracked
          // history - never overwrite it, and never create a duplicate billing line.
          // Only permitted write: additive photo_urls fill when the line has none.
          calRow._mergeReserved = true;
          if (!(calRow.photo_urls || []).length && (row.photo_urls || []).length) {
            toUpdate.push({ id: calRow.id, photo_urls: row.photo_urls });
            feePhotosFilled++;
          } else {
            skipped++;
          }
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

    return Response.json({
      source: 'probuild',
      window: { start_date: startStr, end_date: endStr },
      project_scan: projectStats,
      projects_qualifying: qualifying.length,
      posts_fetched: allPosts.length,
      posts_in_window: inWindowPosts.length,
      created: toCreate.length,
      updated: toUpdate.length,
      append_only: true,
      fr_skipped_existing: frSkippedExisting,
      fr_photos_filled: frPhotosFilled,
      fee_photos_filled: feePhotosFilled,
      merged_into_calendar: merged_count,
      skipped_manually_adjusted: skipped,
      auto_created_jobs: autoCreateNames,
      flagged_for_review: flagged,
      phillip_grover_rows: phillipGrover,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}


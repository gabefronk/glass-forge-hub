import { extractExplicitService, extractPhotoUrls, canonicalPostRows, denverDate } from "../../shared/billingCore.js";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeJobName, planIngestJobs, pendingIdResolver, draftRecord, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, mergeReviewFlags } from '../../shared/ingestShared.ts';
import { countAttachments } from '../../shared/reportMatching.ts';
import { toMs, getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject, filterProjectsByWindow } from '../../shared/probuildApi.ts';
import { fetchAllPages } from '../../shared/pagination.ts';
import { parseServiceBilling } from '../../shared/serviceBilling.ts';

// Ingest Probuild posts into FeeLines + FieldReports. One row per post.
// Auth: Firebase refresh-token exchange (rotated token persisted to ProbuildAuth).
// Data: Firebase RTDB. Projects filtered by lastModifiedAt within 21-day window
// (no deletedAt). Posts fetched per-project, createdAt converted UTC → America/Denver
// before deriving job_date. LLM extracts man_hours/trip_charges from the verbatim
// note (never inferred). Existing lines are append-only (photo and explicit
// service-quantity fills only, see serviceFill); never overwrites a manually
// adjusted, billed or locked row. photo_urls are merged, never wiped: existing
// archived URLs survive re-syncs, and posts with attachments but no URLs get their
// bytes archived into Base44 file storage (no ProBuild link dependency).
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
  // Size guard: a giant attachment (e.g. a long video) buffered whole OOMs the
  // worker - this killed every pull whose window covered 2026-09-01..09-04 even
  // with chunked post fetching. Skip anything over the cap; archiving is
  // best-effort and a skipped file must never fail the pull.
  const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
  const head = await fetch(url, { method: 'HEAD', headers: { Authorization: 'Firebase ' + idToken } }).catch(() => null);
  if (head && head.ok) {
    const len = Number(head.headers.get('content-length') || 0);
    if (len > MAX_ATTACHMENT_BYTES) return null;
  }
  const res = await fetch(url, { headers: { Authorization: 'Firebase ' + idToken } });
  if (!res.ok) return null;
  const mime = res.headers.get('content-type') || attachment?.mimeType || 'image/jpeg';
  if (/text\/html|application\/json/.test(mime)) return null;
  let buf;
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (reader) {
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ATTACHMENT_BYTES) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  } else {
    buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) return null;
  }
  if (!buf.byteLength) return null;
  // 'file' attachments are usually PDFs; keep their extension so the job page can embed them.
  const name = attachment?.fileMetadata?.name || `${attachmentId}.${mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg'}`;
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

// Additive service fill. A standalone ProBuild line stored at $0 because its note's
// quantity could not be read (e.g. "2 man vinyl hours") gets the explicit quantity
// and the configured material rate, but only when the line is untouched: not
// manually adjusted, billed, superseded, merged into a calendar line or in a locked
// month, with no quantity recorded yet. The note must now read as exactly one
// explicit quantity and one material; anything ambiguous stays in review. A line
// that already has a nonzero amount is never changed.
function serviceFill(ex, row, ext, lockedMonths) {
  if (ex.source !== 'probuild' || ex.calendar_event_id || ex.manually_adjusted || ex.billed_to_bfs || ex.superseded_by) return null;
  if (lockedMonths.has(ex.invoice_month) || ex.man_hours != null || computeLaborAmt(ex) !== 0) return null;
  if (!(Number(row.man_hours) > 0) || ext.needs_review || row.service_review_status !== 'ready') return null;
  if (ex.trip_charges != null && Number(ex.trip_charges) !== Number(row.trip_charges || 0)) return null;
  const patch = {
    man_hours: row.man_hours,
    trip_charges: row.trip_charges,
    service_material: row.service_material,
    service_rate: row.service_rate,
    service_labor_amount: row.service_labor_amount,
    service_trip_amount: row.service_trip_amount,
    service_total: row.service_total,
    service_calculation_source: row.service_calculation_source,
    service_review_status: 'ready',
    pricing_review_reason: null,
    // The quantity question is answered; an unlinked job still needs review.
    needs_review: !ex.job_id,
  };
  const filled = { ...ex, ...patch };
  return { ...patch, labor_amt: computeLaborAmt(filled), fee_amt: computeFeeAmt(filled) };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    // Scheduled workflows run with no end user (null); signed-in callers must be admin/manager.
    const user = await base44.auth.me().catch(() => null);
    if (user && !['admin', 'manager'].includes(user.role)) return Response.json({ error: 'forbidden' }, { status: 403 });
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

    // 3. Fetch posts per qualifying project (pooled).
    // A handful of projects carry very large post histories; fetching every
    // qualifying project concurrently spiked worker memory and killed
    // month-wide runs (500s on any window covering 2026-09-01..09-04).
    // Fetch at most POOL projects at a time, and degrade a single failing
    // project to an error entry instead of killing the whole run.
    const POOL = 5;
    const allPosts = [];
    const projectErrors = [];
    for (let i = 0; i < qualifying.length; i += POOL) {
      const batch = qualifying.slice(i, i + POOL);
      const results = await Promise.all(batch.map(async (p) => {
        try {
          const posts = await fetchProbuildPostsForProject(idToken, p.id, { startStr, endStr });
          return posts.map(post => ({ ...post, projectName: p.name || p.title || '' }));
        } catch (e) {
          projectErrors.push({ project_id: p.id, project_name: p.name || p.title || '', error: String((e && e.message) || e).slice(0, 200) });
          return [];
        }
      }));
      for (const r of results) allPosts.push(...r);
    }

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

    // Existing billing lines and locked months (needed before job matching).
    const existingFees = await fetchAllPages(base44.asServiceRole.entities.FeeLines, '-created_date', 1000);
    const existingByPostId = canonicalPostRows(existingFees);
    const lockedMonths = new Set(existingFees.filter(f => f.source === 'sheet-import').map(f => f.invoice_month));
    for (const snap of await fetchAllPages(base44.asServiceRole.entities.MonthCloseSnapshot, '-created_date', 1000)) lockedMonths.add(snap.month);

    // 6. Jobs: resolve each post to its canonical existing job (owner-confirmed
    // project link, then customer + address parsed from the project name, then
    // name). One job is created per new identity per run; ambiguous posts stay
    // unlinked and flagged for review.
    const jobsArr = await fetchAllPages(base44.asServiceRole.entities.Jobs, '-created_date', 1000);
    const projectJob = new Map();
    try {
      for (const l of await fetchAllPages(base44.asServiceRole.entities.ProbuildProjectLink, '-updated_date', 1000)) {
        if (l.project_id && l.job_id && !projectJob.has(l.project_id)) projectJob.set(l.project_id, l.job_id);
      }
    } catch (_) {
      // Links are a hint only; matching still works from the project name.
    }
    inWindowPosts.sort((x, y) => x.jobDate.localeCompare(y.jobDate) || String(x.postId).localeCompare(String(y.postId)));
    const matched = inWindowPosts.map((b) => ({ b, normName: normalizeJobName(b.projectName) }));
    const plan = planIngestJobs(matched.map(({ b, normName }) => {
      const ex = existingByPostId.get(b.postId);
      return {
        key: b.postId, normName, rawName: b.projectName,
        linkedJobId: projectJob.get(b.projectId) || '',
        currentJobId: ex?.job_id || '',
        // Existing lines are append-only and locked months are skipped: no job.
        noCreate: !!ex || lockedMonths.has(invoiceMonthFromDate(b.jobDate)),
      };
    }), jobsArr, (item) => ({ canonical_name: item.normName, aliases: [item.normName] }));
    const newJobs = plan.drafts.length
      ? await base44.asServiceRole.entities.Jobs.bulkCreate(plan.drafts.map(draftRecord))
      : [];
    const realJobId = pendingIdResolver(plan.drafts, newJobs);
    for (const x of matched) {
      const m = plan.results.get(x.b.postId);
      const jobId = realJobId(m.job_id);
      x.m = m.job_id && !jobId ? { ...m, job_id: null, match_confidence: 'unmatched', needs_review: true, reason: 'job_create_unconfirmed' } : { ...m, job_id: jobId };
    }
    const jobReviews = matched.filter((x) => !x.m.job_id && x.m.needs_review)
      .map((x) => ({ post_id: x.b.postId, job_name: x.b.projectName, reason: x.m.reason, candidate_job_ids: x.m.candidate_job_ids || [] }));

    // 8. Write FieldReports (upsert on post_id)
    const existingReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-created_date', 1000);
    const reportByPostId = new Map();
    for (const r of existingReports) if (r.post_id) reportByPostId.set(r.post_id, r);
    const frToCreate = [];
    const frToUpdate = [];
    let frSkippedExisting = 0;
    let frPhotosFilled = 0;
    let frJobsLinked = 0;
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
        ...(m.job_id ? { job_id: m.job_id, job_link_source: 'ingest_match', job_linked_at: new Date().toISOString() } : {}),
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
        // Permitted additive repairs: fill missing photo_urls, and (owner-approved
        // 2026-09-26) fill a missing job_id from a high-confidence match.
        const patch = {};
        if (!(exRep.photo_urls || []).length && photoUrls.length) {
          patch.photo_urls = photoUrls;
          frPhotosFilled++;
        }
        if (!exRep.job_id && m.job_id && m.match_confidence === 'high') {
          Object.assign(patch, { job_id: m.job_id, job_link_source: 'ingest_match', job_linked_at: new Date().toISOString() });
          frJobsLinked++;
        }
        if (Object.keys(patch).length) frToUpdate.push({ id: exRep.id, ...patch });
        else frSkippedExisting++;
      }
      else frToCreate.push(reportRow);
    }
    if (frToCreate.length) await base44.asServiceRole.entities.FieldReports.bulkCreate(frToCreate);
    if (frToUpdate.length) await base44.asServiceRole.entities.FieldReports.bulkUpdate(frToUpdate);


    // 7. Build FeeLines rows + upsert on probuild_post_id
    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
    let merged_count = 0;
    let feePhotosFilled = 0;
    const serviceFilled = [];
    const flagged = [];
    const phillipGrover = [];
    for (const { b, normName, m } of matched) {
      const post = b.post;
      const ext = extractionMap.get(b.postId) || { needs_review: true };
      const jobId = m.job_id;
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
        // Permitted additive writes: photo_urls when the line has none, and an explicit
        // service quantity on an untouched $0 line (see serviceFill).
        const patch = {};
        if (!(ex.photo_urls || []).length && (row.photo_urls || []).length) {
          patch.photo_urls = row.photo_urls;
          feePhotosFilled++;
        }
        const fill = serviceFill(ex, row, ext, lockedMonths);
        if (fill) {
          Object.assign(patch, fill);
          serviceFilled.push({ id: ex.id, post_id: b.postId, job_date: ex.job_date, labor_amt: fill.labor_amt });
        }
        if (Object.keys(patch).length) toUpdate.push({ id: ex.id, ...patch });
        else skipped++;
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
      project_errors: projectErrors,
      posts_in_window: inWindowPosts.length,
      created: toCreate.length,
      updated: toUpdate.length,
      append_only: true,
      fr_skipped_existing: frSkippedExisting,
      fr_photos_filled: frPhotosFilled,
      fee_photos_filled: feePhotosFilled,
      service_quantity_filled: serviceFilled,
      merged_into_calendar: merged_count,
      skipped_manually_adjusted: skipped,
      auto_created_jobs: newJobs.map((j) => j.canonical_name),
      job_match_reviews: jobReviews,
      flagged_for_review: flagged,
      phillip_grover_rows: phillipGrover,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

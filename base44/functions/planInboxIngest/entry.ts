import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { validateLines } from '../../shared/windowQuotesCore.js';

// Plans Inbox ingest.
// Watches the Google Drive folder "Glass Forge Plans Inbox / 1 - Drop Plans Here".
// For each new PDF: download via the googledrive connector -> split into single-page
// PDFs (pdf-lib) -> upload each page to Base44 storage -> per-page LLM extraction of
// window/door openings -> merge + deterministic IRC R308.4 tempering rules -> create a
// Window Quotes DRAFT (QuoteRequests, worker_status 'draft', never queued) -> move the
// PDF to "2 - Processed" and drop a takeoff CSV beside it.
//
// Each run is time-boxed (BUDGET_MS) and checkpoints progress in PlanIntake, so a big
// set just takes a few scheduled runs. Idempotent on drive_file_id and request_id.
// Deploy v1.

const DROP_FOLDER = '1sRaRX-ezKQRiHjoR0d215kCcqk3ajE8O';
const PROCESSED_FOLDER = '1Ozz8F3tLwYS1JKFnZ7yAnBY7K1OanTbG';
const OWNER_EMAIL = 'gabefronk@gmail.com'; // Window Quotes administrator that owns auto-created drafts
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const BUDGET_MS = 48000;
const PAGE_BATCH = 3;
const MAX_ATTEMPTS = 6;

const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    page_type: { type: 'string', enum: ['cover', 'general_notes', 'window_schedule', 'floor_plan', 'elevation', 'section', 'detail', 'electrical', 'structural', 'site', 'other'] },
    sheet_id: { type: ['string', 'null'] },
    sheet_title: { type: ['string', 'null'] },
    level: { type: ['string', 'null'], description: 'basement, main, second, etc. if the sheet is a floor plan' },
    job_name: { type: ['string', 'null'] },
    builder: { type: ['string', 'null'] },
    window_spec_notes: { type: ['string', 'null'], description: 'Brand, material, glazing, color notes found on this page' },
    openings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Exact callout as printed, e.g. 3050SH, 5070FX, 10080' },
          kind: { type: 'string', enum: ['window', 'exterior_door', 'garage_door', 'interior_door', 'unknown'] },
          qty: { type: 'integer' },
          room: { type: ['string', 'null'] },
          level: { type: ['string', 'null'] },
          wall: { type: ['string', 'null'], description: 'front/rear/left/right/north/south/east/west if determinable' },
          sill_height_in: { type: ['number', 'null'], description: 'Bottom of glass above finished floor, inches, ONLY if printed or dimensioned' },
          head_height_in: { type: ['number', 'null'] },
          distance_to_door_in: { type: ['number', 'null'], description: 'Horizontal distance from nearest door edge, inches, only if shown' },
          adjacent_to_door: { type: ['boolean', 'null'] },
          at_stairs_or_landing: { type: ['boolean', 'null'] },
          wet_area: { type: ['boolean', 'null'], description: 'In a tub/shower/pool wall' },
          egress: { type: ['boolean', 'null'] },
          tempered_called_out: { type: ['boolean', 'null'], description: 'True only if the drawing itself says TEMP / TG / tempered at this opening' },
          notes: { type: ['string', 'null'] }
        },
        required: ['tag', 'kind', 'qty']
      }
    }
  },
  required: ['page_type', 'openings']
};

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    job_name: { type: ['string', 'null'] },
    builder: { type: ['string', 'null'] },
    window_spec: { type: ['string', 'null'] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          mark: { type: 'string' },
          tag: { type: 'string' },
          kind: { type: 'string', enum: ['window', 'exterior_door', 'garage_door'] },
          qty: { type: 'integer' },
          style: { type: 'string' },
          room: { type: ['string', 'null'] },
          level: { type: ['string', 'null'] },
          wall: { type: ['string', 'null'] },
          sill_height_in: { type: ['number', 'null'] },
          distance_to_door_in: { type: ['number', 'null'] },
          adjacent_to_door: { type: ['boolean', 'null'] },
          at_stairs_or_landing: { type: ['boolean', 'null'] },
          wet_area: { type: ['boolean', 'null'] },
          egress: { type: ['boolean', 'null'] },
          tempered_called_out: { type: ['boolean', 'null'] },
          source_sheets: { type: 'array', items: { type: 'string' } },
          notes: { type: ['string', 'null'] }
        },
        required: ['mark', 'tag', 'kind', 'qty', 'style']
      }
    },
    review_notes: { type: 'array', items: { type: 'string' } }
  },
  required: ['lines']
};

const PAGE_PROMPT = `You are reading ONE page of a residential construction plan set (Utah, 2021 IRC). Extract every window and exterior door callout printed on this page.

Rules:
- Copy tags exactly as printed (examples: 3050SH, 5070FX, 2620FX, 4050RS, 10080, 6080, 180100). Do not invent tags.
- On FLOOR PLANS: record the room the opening sits in, the level (basement/main/second), and any dimension strings that show sill height ("SILL 30\\"", "S.H. 2'-6\\""), distance to a door, or that the opening is in a tub/shower wall, at a stair, or at a landing.
- On ELEVATIONS: tags are usually printed twice per opening (outline + fill); count each physical opening once. Note which wall the elevation shows.
- On WINDOW SCHEDULES: capture every row with qty, type, size and remarks.
- Doors with glass (patio sliders, multi-slides, french doors, glass entry doors) are exterior_door. Garage doors are garage_door. Interior doors (2680, 3080 etc. inside the plan) are interior_door.
- sill_height_in, distance_to_door_in, at_stairs_or_landing, wet_area must be null unless the drawing actually shows it. Never guess.
- Also pull job name, builder, and any window spec notes (brand, material, color, glazing) if this page has them.
Return only the JSON described by the schema.`;

const MERGE_PROMPT = `You are consolidating per-page extractions from one residential plan set into a single window/door takeoff.

Input: a JSON array of pages, each with page_type, sheet_id, level and an openings list.
Task:
1. Build ONE line per physical opening group: same tag + same room/level = one line with qty. Floor plans are the source of truth for count and room; elevations only confirm wall and catch side-wall tags that floor-plan text missed. Elevation tags are printed twice per opening, so never let an elevation double a count.
2. Drop interior_door entries entirely. Keep garage doors but mark kind garage_door.
3. Carry over sill_height_in, distance_to_door_in, adjacent_to_door, at_stairs_or_landing, wet_area, egress, tempered_called_out from whichever page showed them. Leave null when no page showed it. Do NOT infer tempering here; a separate rule engine decides that.
4. style: expand the tag suffix — SH single hung, DH double hung, SL or RS slider, CS/SC casement, AW awning, FX/PIC fixed, PW picture; doors: patio slider, multi-slide, french, entry, garage. If unsure write the raw suffix.
5. mark: sequential W1, W2 ... for windows, D1, D2 ... for doors, in floor-plan order (basement, main, second; rear, front, sides).
6. review_notes: anything a human should double check (count mismatches between plan and elevation, tags with no room, missing schedule).
Return only the JSON described by the schema.`;

function parseCallSize(tag) {
  const m = String(tag || '').toUpperCase().match(/^(\d{4,6})/);
  if (!m) return null;
  const d = m[1];
  let wf, wi, hf, hi;
  if (d.length === 4) [wf, wi, hf, hi] = [d[0], d[1], d[2], d[3]];
  else if (d.length === 5) [wf, wi, hf, hi] = [d.slice(0, 2), d[2], d[3], d[4]];
  else [wf, wi, hf, hi] = [d.slice(0, 2), d[2], d.slice(3, 5), d[5]];
  const w = Number(wf) * 12 + Number(wi);
  const h = Number(hf) * 12 + Number(hi);
  if (!w || !h) return null;
  return { width: w, height: h };
}

// Deterministic IRC R308.4 pass. Returns { tempered: true|false|'verify', reason }
function temperingRule(line, width, height) {
  const sill = line.sill_height_in;
  const area = (width && height) ? (width * height) / 144 : null;
  if (line.kind === 'exterior_door') return { tempered: true, reason: 'IRC R308.4.1 - glazing in a door' };
  if (line.kind === 'garage_door') return { tempered: 'verify', reason: 'Garage door - tempered only if it has glass lites' };
  if (line.tempered_called_out === true) return { tempered: true, reason: 'Called out tempered on the drawings' };
  if (line.wet_area === true) {
    if (sill === null || sill === undefined || sill < 60) return { tempered: true, reason: 'IRC R308.4.5 - tub/shower wall, bottom edge under 60 in above standing surface' };
    return { tempered: false, reason: 'Wet area but sill 60 in or higher' };
  }
  if (line.at_stairs_or_landing === true) {
    if (sill === null || sill === undefined || sill < 36) return { tempered: true, reason: 'IRC R308.4.6/4.7 - at stair or landing, bottom edge under 36 in above walking surface' };
    return { tempered: false, reason: 'At stair but sill 36 in or higher' };
  }
  const nearDoor = line.adjacent_to_door === true || (typeof line.distance_to_door_in === 'number' && line.distance_to_door_in <= 24);
  if (nearDoor) {
    if (sill === null || sill === undefined || sill < 60) return { tempered: true, reason: 'IRC R308.4.2 - within 24 in of a door edge, bottom edge under 60 in' };
    return { tempered: false, reason: 'Near door but sill 60 in or higher' };
  }
  if (area !== null && area > 9) {
    if (typeof sill === 'number') {
      if (sill < 18 && sill + height > 36) return { tempered: true, reason: 'IRC R308.4.3 - lite over 9 sq ft, bottom edge under 18 in, top edge over 36 in' };
      return { tempered: false, reason: 'Over 9 sq ft but sill 18 in or higher' };
    }
    return { tempered: 'verify', reason: 'VERIFY - lite over 9 sq ft and sill height not shown on plans (R308.4.3); also confirm distance to doors/stairs' };
  }
  if (line.room && /bath|shower|tub|powder|master|primary/i.test(line.room) && line.wet_area === null) {
    return { tempered: 'verify', reason: 'VERIFY - bathroom window; confirm whether it sits in the tub/shower wall (R308.4.5)' };
  }
  if (line.adjacent_to_door === null && line.at_stairs_or_landing === null && (sill === null || sill === undefined)) {
    return { tempered: 'verify', reason: 'VERIFY - no sill height or door/stair adjacency shown on plans' };
  }
  return { tempered: false, reason: 'No hazardous-location trigger shown (R308.4)' };
}

function styleToHubStyle(line) {
  const s = String(line.style || '').trim();
  return s || (line.kind === 'window' ? 'Window' : 'Door');
}

function toCsv(rows) {
  const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['mark', 'tag', 'kind', 'qty', 'style', 'width_in', 'height_in', 'room', 'level', 'wall', 'sill_in', 'tempered', 'code_reason', 'notes'];
  return [head.join(','), ...rows.map(r => head.map(k => esc(r[k])).join(','))].join('\n') + '\n';
}

async function driveJson(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error('Drive ' + res.status + ' ' + url.split('?')[0] + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

async function listDrop(token) {
  const q = encodeURIComponent(`'${DROP_FOLDER}' in parents and mimeType='application/pdf' and trashed=false`);
  const data = await driveJson(token, `${DRIVE}/files?q=${q}&fields=files(id,name,size,createdTime)&pageSize=50&orderBy=createdTime`);
  return data.files || [];
}

async function downloadPdf(token, fileId) {
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('Drive download ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return new Uint8Array(await res.arrayBuffer());
}

async function moveToProcessed(token, fileId) {
  return driveJson(token, `${DRIVE}/files/${fileId}?addParents=${PROCESSED_FOLDER}&removeParents=${DROP_FOLDER}&fields=id,parents`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

async function uploadCsv(token, name, csv) {
  const boundary = 'gfhub' + crypto.randomUUID();
  const meta = JSON.stringify({ name, parents: [PROCESSED_FOLDER], mimeType: 'text/csv' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--`;
  return driveJson(token, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
}

export default async function planInboxIngest(req) {
  const t0 = Date.now();
  const left = () => BUDGET_MS - (Date.now() - t0);
  const out = { discovered: 0, created: 0, worked: null, status: null, notes: [] };
  try {
    const base44 = createClientFromRequest(req);
    // Scheduled workflows have no user; a signed-in caller must be an admin.
    let user = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    if (user && user.role !== 'admin' && user.role !== 'manager') return Response.json({ error: 'forbidden' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;
    const core = base44.asServiceRole.integrations.Core;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    if (!accessToken) return Response.json({ error: 'googledrive connector is not connected' }, { status: 200 });

    // 1. Discover new PDFs in the drop folder.
    const files = await listDrop(accessToken);
    out.discovered = files.length;
    const known = await db.PlanIntake.list('-created_date', 500);
    const byFile = new Map(known.map(r => [r.drive_file_id, r]));
    for (const f of files) {
      if (byFile.has(f.id)) continue;
      const row = await db.PlanIntake.create({ drive_file_id: f.id, file_name: f.name, file_size: Number(f.size || 0), drive_created_time: f.createdTime || '', status: 'new', page_urls: [], page_results: [], pages_done: 0, attempts: 0, log: ['discovered'] });
      byFile.set(f.id, row);
      out.created++;
    }

    // 2. Pick one intake to advance (oldest unfinished), or the one the caller named.
    let intake = null;
    if (body.file_id) intake = byFile.get(body.file_id) || null;
    if (!intake) {
      const pending = [...byFile.values()].filter(r => !['done', 'error', 'skipped'].includes(r.status)).sort((a, b) => (a.created_date || '').localeCompare(b.created_date || ''));
      intake = pending[0] || null;
    }
    if (!intake) return Response.json({ ...out, notes: ['nothing pending'] });
    out.worked = { id: intake.id, file: intake.file_name, status_before: intake.status };

    const log = [...(intake.log || [])];
    const save = async patch => { intake = await db.PlanIntake.update(intake.id, patch); return intake; };
    const logSave = async (msg, patch = {}) => { log.push(new Date().toISOString().slice(11, 19) + ' ' + msg); return save({ ...patch, log: log.slice(-60) }); };

    if ((intake.attempts || 0) >= MAX_ATTEMPTS) {
      await logSave('gave up after ' + intake.attempts + ' attempts', { status: 'error', error: intake.error || 'max attempts' });
      out.status = 'error'; return Response.json(out);
    }
    await save({ attempts: (intake.attempts || 0) + 1, started_at: intake.started_at || new Date().toISOString() });

    // 3a. new -> split pages and upload each.
    if (intake.status === 'new') {
      const bytes = await downloadPdf(accessToken, intake.drive_file_id);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const n = src.getPageCount();
      if (n === 0) { await logSave('pdf has no pages', { status: 'error', error: 'empty pdf' }); out.status = 'error'; return Response.json(out); }
      const urls = [];
      for (let i = 0; i < n; i++) {
        const one = await PDFDocument.create();
        const [p] = await one.copyPages(src, [i]);
        one.addPage(p);
        const pageBytes = await one.save();
        const file = new File([pageBytes], `plan-${intake.drive_file_id}-p${String(i + 1).padStart(2, '0')}.pdf`, { type: 'application/pdf' });
        const { file_url } = await core.UploadFile({ file });
        urls.push(file_url);
        if (left() < 8000) { await logSave(`split ${urls.length}/${n} pages, out of time`, { page_count: n, page_urls: urls, page_results: new Array(n).fill(null) }); out.status = 'splitting'; return Response.json(out); }
      }
      await logSave(`split ${n} pages`, { status: 'pages_split', page_count: n, page_urls: urls, page_results: new Array(n).fill(null), pages_done: 0 });
    }
    // Resume a partial split (page_urls shorter than page_count).
    if (intake.status === 'new' && intake.page_count && (intake.page_urls || []).length < intake.page_count) {
      // Fall through next run; simplest is to restart the split from scratch.
      await logSave('restarting split', { page_urls: [], page_results: [] });
      out.status = 'splitting'; return Response.json(out);
    }

    // 3b. pages_split / extracting -> per-page LLM extraction in small parallel batches.
    if (intake.status === 'pages_split' || intake.status === 'extracting') {
      const results = [...(intake.page_results || [])];
      const urls = intake.page_urls || [];
      const todo = urls.map((u, i) => [u, i]).filter(([, i]) => !results[i]);
      await save({ status: 'extracting' });
      for (let b = 0; b < todo.length; b += PAGE_BATCH) {
        if (left() < 15000) break;
        const batch = todo.slice(b, b + PAGE_BATCH);
        const settled = await Promise.allSettled(batch.map(([url, i]) => core.InvokeLLM({ prompt: PAGE_PROMPT + `\n\nThis is page ${i + 1} of ${urls.length}.`, response_json_schema: PAGE_SCHEMA, file_urls: [url], add_context_from_internet: false })));
        settled.forEach((s, k) => {
          const i = batch[k][1];
          if (s.status === 'fulfilled' && s.value && typeof s.value === 'object') results[i] = { page: i + 1, ...s.value };
          else results[i] = { page: i + 1, page_type: 'other', openings: [], extraction_error: String(s.reason?.message || s.reason || 'unknown').slice(0, 300) };
        });
        const done = results.filter(Boolean).length;
        await logSave(`extracted ${done}/${urls.length}`, { page_results: results, pages_done: done });
      }
      const done = results.filter(Boolean).length;
      if (done < urls.length) { out.status = 'extracting'; return Response.json(out); }
      await logSave('all pages extracted', { status: 'merging' });
    }

    // 3c. merging -> consolidate, apply R308.4, create draft, move file, write CSV.
    if (intake.status === 'merging') {
      const pages = (intake.page_results || []).map(p => ({ page: p.page, page_type: p.page_type, sheet_id: p.sheet_id, sheet_title: p.sheet_title, level: p.level, job_name: p.job_name, builder: p.builder, window_spec_notes: p.window_spec_notes, openings: (p.openings || []).filter(o => o && o.kind !== 'interior_door') }));
      const merged = await core.InvokeLLM({ prompt: MERGE_PROMPT + '\n\nPages:\n' + JSON.stringify(pages).slice(0, 180000), response_json_schema: MERGE_SCHEMA, add_context_from_internet: false });
      const jobName = merged.job_name || intake.file_name.replace(/\.pdf$/i, '');
      const lines = [];
      const csvRows = [];
      let idx = 0;
      for (const l of merged.lines || []) {
        if (!l || !l.tag) continue;
        idx++;
        const size = parseCallSize(l.tag);
        const width = size?.width ?? null;
        const height = size?.height ?? null;
        const rule = temperingRule(l, width, height);
        const line = {
          id: l.mark || `L${idx}`,
          mark: l.mark || `L${idx}`,
          qty: Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 1,
          style: styleToHubStyle(l),
          room: [l.level, l.room].filter(Boolean).join(' - ') || 'Unknown',
          units: 'in',
          dimension_basis: 'call',
          options: {
            call_size: l.tag,
            kind: l.kind,
            wall: l.wall || null,
            sill_height_in: typeof l.sill_height_in === 'number' ? l.sill_height_in : null,
            egress: l.egress === true,
            tempered: rule.tempered,
            tempering_reason: rule.reason,
            source_sheets: l.source_sheets || [],
            notes: l.notes || null
          }
        };
        if (width) line.width = width;
        if (height) line.height = height;
        lines.push(line);
        csvRows.push({ mark: line.mark, tag: l.tag, kind: l.kind, qty: line.qty, style: line.style, width_in: width, height_in: height, room: l.room, level: l.level, wall: l.wall, sill_in: line.options.sill_height_in, tempered: rule.tempered === true ? 'YES' : rule.tempered === false ? 'NO' : 'VERIFY', code_reason: rule.reason, notes: l.notes });
      }
      const safeLines = validateLines(lines);
      const requestId = 'plans-inbox-' + intake.drive_file_id;
      const existing = await db.QuoteRequests.filter({ request_id: requestId, requester_email: OWNER_EMAIL }, 'created_date', 1);
      let quote = existing[0] || null;
      const summary = `Auto-generated from the Google Drive Plans Inbox. ${safeLines.length} lines; ` +
        `${csvRows.filter(r => r.tempered === 'YES').length} tempered, ${csvRows.filter(r => r.tempered === 'VERIFY').length} to verify. ` +
        (merged.window_spec ? `Window spec on plans: ${merged.window_spec}. ` : '') +
        (merged.review_notes?.length ? 'Review: ' + merged.review_notes.join(' | ') : '');
      if (!quote) {
        quote = await db.QuoteRequests.create({
          request_id: requestId,
          title: jobName,
          requester_email: OWNER_EMAIL,
          settings: {},
          lines: safeLines,
          source: { type: 'plans_inbox', drive_file_id: intake.drive_file_id, drive_file_name: intake.file_name, page_count: intake.page_count, builder: merged.builder || null, window_spec: merged.window_spec || null, review_notes: merged.review_notes || [], processed_by: 'planInboxIngest', processed_on: new Date().toISOString().slice(0, 10) },
          input_revision: 1, state_version: 0, worker_status: 'draft', sales_status: 'open',
          missing_details: [], history: [], job_id: '', accepted_revision: 0, lease_token: '', conversion_token: '',
          conversation: [{ role: 'user', content: summary.slice(0, 18000), revision: 1, client_message_id: requestId + ':initial', message_at: new Date().toISOString(), author: 'planInboxIngest', kind: 'initial_request' }]
        });
      }
      let csvId = intake.csv_file_id || '';
      try { await moveToProcessed(accessToken, intake.drive_file_id); } catch (e) { log.push('move failed: ' + String(e.message || e).slice(0, 200)); }
      if (!csvId) {
        try { const up = await uploadCsv(accessToken, intake.file_name.replace(/\.pdf$/i, '') + ' - takeoff.csv', toCsv(csvRows)); csvId = up.id || ''; } catch (e) { log.push('csv upload failed: ' + String(e.message || e).slice(0, 200)); }
      }
      await logSave(`draft ${quote.id} created with ${safeLines.length} lines`, { status: 'done', job_name: jobName, builder: merged.builder || '', final_lines: csvRows, quote_id: quote.id, csv_file_id: csvId, finished_at: new Date().toISOString(), error: '' });
      out.status = 'done'; out.quote_id = quote.id; out.lines = safeLines.length;
      return Response.json(out);
    }

    out.status = intake.status;
    return Response.json(out);
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    try {
      const base44 = createClientFromRequest(req);
      if (out.worked?.id) await base44.asServiceRole.entities.PlanIntake.update(out.worked.id, { error: msg });
    } catch { /* ignore */ }
    return Response.json({ ...out, error: msg }, { status: 200 });
  }
}

// ProBuild recovery revision probuild-refresh-20260913-r1.
// base44/functions/probuild-refresh/entry.ts
import { createClientFromRequest } from "npm:@base44/sdk@0.8.48";

// base44/shared/probuildApi.ts
import { secrets } from "base44:runtime";
var FIREBASE_API_KEY = "AIzaSyD-bRl-_9tZLccN3HQ9IMy27pY37VKY1xc";
var FIREBASE_TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
async function getProbuildIdToken(base44) {
  const authRecords = await base44.asServiceRole.entities.ProbuildAuth.list("-updated_date", 1);
  let refreshToken = authRecords.length > 0 ? authRecords[0].refresh_token : secrets.get("PROBUILD_REFRESH_TOKEN");
  if (!refreshToken) throw new Error("no_refresh_token");
  const tokenRes = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "https://portal.probuild.app/"
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  });
  if (tokenRes.status === 401) {
    throw new Error("probuild_auth_401: Refresh token rejected. Capture a fresh Probuild refresh token and update PROBUILD_REFRESH_TOKEN / ProbuildAuth.");
  }
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`probuild_auth_failed: ${tokenRes.status} ${txt}`);
  }
  const tokenData = await tokenRes.json();
  const idToken = tokenData.id_token;
  const rotatedRefreshToken = tokenData.refresh_token;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (authRecords.length > 0) {
    await base44.asServiceRole.entities.ProbuildAuth.update(authRecords[0].id, {
      refresh_token: rotatedRefreshToken,
      last_exchanged_at: nowIso
    });
  } else {
    await base44.asServiceRole.entities.ProbuildAuth.create({
      refresh_token: rotatedRefreshToken,
      last_exchanged_at: nowIso
    });
  }
  return idToken;
}

// base44/shared/fieldLibrary.js
var TEAM = "-O7aXXhvthc41u60Koc6";
var DB = "https://probuild-prod.firebaseio.com/teams/" + TEAM;
var OWNERS = /* @__PURE__ */ new Set(["gabefronk@gmail.com", "gabriel.fronk.wd@gmail.com"]);
var ID = /^[A-Za-z0-9_-]{1,160}$/;
var fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { publicMessage: message, status });
};
var id = (v) => ID.test(v || "") ? v : fail("Invalid identifier.");
var entries = (v) => Object.entries(v || {}).filter(([, x]) => x && typeof x === "object");
var json = (v, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
var hashBytes = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
var hash = async (value) => hashBytes(new TextEncoder().encode(value));
var sourceKey = (...parts) => ["probuild", TEAM, ...parts].join(":");
var iso = (v) => typeof v === "number" ? new Date(v).toISOString() : String(v || "");
var date = (value) => {
  const v = iso(value);
  return Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v)) : "";
};
var escapeRegex = (s) => String(s || "").slice(0, 150).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function all(entity, query = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await entity.filter(query, "id", 500, offset);
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
async function parallel(items, fn, n = 5) {
  let next = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (; ; ) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}
async function boundedBytes(response, max = 104857600) {
  if (Number(response.headers.get("content-length")) > max) fail("File exceeds the 100 MB transfer limit.", 413);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        fail("File exceeds the 100 MB transfer limit.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, pos);
    pos += chunk.length;
  }
  return bytes;
}
async function mergeRows(entity, existing, rows) {
  const byKey = new Map(existing.map((r) => [r.source_key, r])), missing = rows.filter((r) => !byKey.has(r.source_key));
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    if (entity.bulkCreate) await entity.bulkCreate(batch);
    else for (const row of batch) await entity.create(row);
  }
  await parallel(rows.filter((r) => byKey.has(r.source_key)), (r) => entity.update(byKey.get(r.source_key).id, r));
}
var displayName = (f) => {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" }[f.mime_type];
  return ext && !f.source_snapshot?.fileMetadata?.name && f.name?.endsWith(".bin") ? f.name.slice(0, -3) + ext : f.name;
};
var publicFile = ({ file_uri, source_snapshot, chunks, ...f }) => ({ ...f, name: displayName({ ...f, source_snapshot }), chunks: (chunks || []).map(({ file_uri: file_uri2, ...c }) => c) });
function reportView(r, files = []) {
  const byKey = new Map(files.map((f) => [f.source_key, f]));
  return { id: r.id, source: "library", project_id: r.source_project_id, project_name: r.project_name, post_id: r.source_post_id, created_at: r.source_created_at, date: r.report_date, message: r.message, deleted: r.source_deleted, attachments: (r.attachments || []).map((a) => {
    const f = byKey.get(a.source_key);
    return f ? { ...a, type: f.mime_type?.startsWith("image/") ? "photo" : a.type || "file", mime_type: f.mime_type || a.mime_type, name: displayName(f) || a.name, size: f.size || a.size, status: f.status } : a;
  }), source_checked_at: r.source_checked_at };
}
function createFieldLibraryHandler({ getClient, getToken, fetchImpl = fetch, now = () => /* @__PURE__ */ new Date() }) {
  const sourceTokenCache = { value: null, until: 0 }, importCache = /* @__PURE__ */ new Map();
  return async (req) => {
    if (req.method !== "POST") return json({ error: "Use POST." }, 405);
    let stage = "authorization";
    try {
      const client = await getClient(req), api = client.asServiceRole.entities, key = req.headers.get("x-glass-forge-control-key");
      if (key) {
        if (key.length < 40 || key.length > 200) fail("Device authorization required.", 401);
        if (!(await api.ProbuildControlDevice.filter({ token_hash: await hash(key), enabled: true }, "-created_date", 1))[0]) fail("Device authorization required.", 401);
      } else {
        const u = await client.auth.me().catch(() => null);
        if (u?.role !== "admin" || !OWNERS.has(String(u.email || "").toLowerCase().trim())) fail("Owner access required.", 403);
      }
      const raw = await req.text();
      if (raw.length > 1048576) fail("Request too large.", 413);
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        fail("Invalid JSON.");
      }
      const { action } = input, at = now().toISOString();
      let tokenPromise;
      const token = () => tokenPromise ||= sourceTokenCache.value && Date.now() < sourceTokenCache.until ? Promise.resolve(sourceTokenCache.value) : getToken(client).then((value) => {
        sourceTokenCache.value = value;
        sourceTokenCache.until = Date.now() + 45 * 6e4;
        return value;
      });
      const provider = async (path) => {
        const r = await fetchImpl(DB + "/" + path + ".json?auth=" + encodeURIComponent(await token()), { signal: AbortSignal.timeout(45e3) });
        if (!r.ok) fail("ProBuild source read failed (HTTP " + r.status + ").", 502);
        return r.json();
      };
      const signed = async (uri) => (await client.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: uri, expires_in: 900 })).signed_url;
      const runFor = async () => {
        const rid = id(input.run_id), cached = importCache.get(rid);
        if (cached && Date.now() < cached.until) return cached.run;
        const run = await api.FieldLibraryImport.get(rid);
        if (!run) fail("Import not found.", 404);
        importCache.set(rid, { run, until: Date.now() + 10 * 6e4 });
        return run;
      };
      if (action === "start_import") {
        const active = (await api.FieldLibraryImport.filter({ phase: { $in: ["metadata", "files"] } }, "-created_date", 1))[0];
        if (active) return json({ run: active, resumed: true });
        const snapshot = await provider("projects"), ids = entries(snapshot).map(([pid]) => pid);
        const run = await api.FieldLibraryImport.create({ phase: "metadata", started_at: at, checked_at: at, source_snapshot: snapshot, project_ids: ids, projects_checked: 0, reports_imported: 0, files_discovered: 0, files_verified: 0, bytes_verified: 0, errors: [], source_complete: false, files_complete: false });
        return json({ run });
      }
      if (action === "import_project") {
        stage = "load-import";
        const run = await runFor(), pid = id(input.project_id);
        if (!run.project_ids.includes(pid)) fail("Project is outside this import.");
        stage = "load-posts";
        const p = run.source_snapshot[pid], posts = await provider("posts/" + pid), pkey = sourceKey(pid);
        stage = "job-link";
        const link = (await api.ProbuildProjectLink.filter({ project_id: pid }, "-updated_date", 1))[0];
        stage = "project-lookup";
        const old = (await api.FieldLibraryProject.filter({ source_key: pkey }, "-created_date", 1))[0];
        stage = "project-build";
        const row = { source_key: pkey, source_project_id: pid, name: p.name || p.title || pid, description: p.description || "", archived: !!p.archivedAt, source_deleted: !!p.deletedAt, job_id: link?.job_id || "", job_name: link?.job_name || "", source_snapshot: p, source_hash: await hash(JSON.stringify(p)), source_checked_at: at, report_count: entries(posts).length, attachment_count: entries(posts).reduce((n, [, post]) => n + entries(post.attachments).length, 0), import_run_id: run.id };
        stage = "project-save";
        const project = old ? await api.FieldLibraryProject.update(old.id, row) : await api.FieldLibraryProject.create(row);
        stage = "existing-records";
        const [existingReports, existingFiles] = await Promise.all([all(api.FieldLibraryReport, { source_project_id: pid }), all(api.FieldLibraryFile, { source_project_id: pid })]);
        const fileMap = new Map(existingFiles.map((f) => [f.source_key, f]));
        const reports = [], files = [];
        for (const [postId, post] of entries(posts)) {
          const attachments = [];
          for (const [attachmentId, a] of entries(post.attachments)) {
            const generation = String(a.generation || ""), fkey = sourceKey(pid, postId, attachmentId, generation), prior = fileMap.get(fkey);
            const name = a.fileMetadata?.name || a.documentName || `${attachmentId}.${a.type === "photo" ? "jpg" : "bin"}`;
            const mime = a.mimeType || (a.type === "photo" ? "image/jpeg" : "application/octet-stream");
            const f = { source_key: fkey, source_project_id: pid, source_post_id: postId, source_attachment_id: attachmentId, generation, name, mime_type: mime, source_type: a.type || "", source_snapshot: a, source_deleted: !!post.deletedAt || !!a.deletedAt, status: prior?.status === "verified" ? "verified" : "pending", source_size: Number(a.fileMetadata?.sizeInBytes) || 0, import_run_id: run.id };
            files.push(f);
            attachments.push({ id: attachmentId, type: a.type || "", generation, name, mime_type: mime, source_key: fkey, size: f.source_size });
          }
          reports.push({ source_key: sourceKey(pid, postId), source_project_id: pid, source_post_id: postId, library_project_id: project.id, project_name: row.name, report_date: date(post.createdAt), source_created_at: iso(post.createdAt), source_deleted: !!post.deletedAt, message: post.message || "", source_snapshot: post, source_hash: await hash(JSON.stringify(post)), source_checked_at: at, attachments, import_run_id: run.id });
        }
        stage = "save-reports";
        await mergeRows(api.FieldLibraryReport, existingReports, reports);
        stage = "save-files";
        await mergeRows(api.FieldLibraryFile, existingFiles, files);
        return json({ project_id: pid, library_project_id: project.id, reports: reports.length, files: files.length, source_deleted: row.source_deleted, archived: row.archived });
      }
      if (action === "pending_files") {
        const run = await runFor();
        return json({ files: (await api.FieldLibraryFile.filter({ import_run_id: run.id, status: { $ne: "verified" } }, "id", Math.min(500, Number(input.limit) || 100), Math.max(0, Number(input.offset) || 0))).map(publicFile) });
      }
      const copyFile = async (fileId) => {
        stage = "load-file";
        const f = await api.FieldLibraryFile.get(id(fileId));
        if (!f) fail("File not found.", 404);
        if (f.status === "verified") return { file: publicFile(f), already_verified: true };
        try {
          const path = `teams/${TEAM}/posts/${id(f.source_project_id)}/${id(f.source_post_id)}/attachments/${id(f.source_attachment_id)}`;
          const url = "https://firebasestorage.googleapis.com/v0/b/probuild-prod.appspot.com/o/" + encodeURIComponent(path) + "?alt=media" + (f.generation ? "&generation=" + encodeURIComponent(f.generation) : "");
          const chunkSize = 6 * 1048576, offset = Number(f.bytes_stored) || 0;
          stage = "read-original-file";
          const response = await fetchImpl(url, { headers: { Authorization: "Firebase " + await token(), Range: `bytes=${offset}-${offset + chunkSize - 1}` }, signal: AbortSignal.timeout(9e4) });
          if (!response.ok) fail("Original attachment unavailable (HTTP " + response.status + ").", 502);
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
          if (response.status === 206 && (!range || Number(range[1]) !== offset)) fail("Source returned an invalid file range.", 502);
          if (offset && !range) fail("Source did not honor the requested file range.", 502);
          const bytes = await boundedBytes(response, chunkSize), mime = response.headers.get("content-type") || f.mime_type, total = range ? Number(range[3]) : bytes.length;
          if (range && Number(range[2]) - Number(range[1]) + 1 !== bytes.length) fail("Source file range is incomplete.", 502);
          if (f.size && f.chunks?.length && f.size !== total) fail("Source file size changed during transfer.", 409);
          if (!bytes.length || /text\/html|application\/json/.test(mime)) fail("Invalid source attachment.", 502);
          const digest = await hashBytes(bytes);
          const multipart = total > chunkSize;
          stage = "upload-private-file";
          const uploaded = await client.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], multipart ? f.name + ".part-" + offset + ".bin" : f.name, { type: multipart ? "application/octet-stream" : mime }) });
          if (!uploaded.file_uri) fail("Glass Forge did not store the file.", 502);
          stage = "verify-private-file";
          const copied = await fetchImpl(await signed(uploaded.file_uri), { signal: AbortSignal.timeout(9e4) });
          if (!copied.ok) fail("Stored file could not be verified.", 502);
          const checked = await boundedBytes(copied, chunkSize);
          if (checked.length !== bytes.length || await hashBytes(checked) !== digest) fail("Stored file does not match its source.", 502);
          const latest = await api.FieldLibraryFile.get(f.id);
          if ((latest.bytes_stored || 0) !== offset) return { file: publicFile(latest), partial: latest.status !== "verified" };
          const chunks = [...f.chunks || [], { offset, size: bytes.length, sha256: digest, file_uri: uploaded.file_uri }], stored = offset + bytes.length, complete = stored === total;
          if (stored > total) fail("Stored file exceeds the source size.", 502);
          const manifest = chunks.map(({ offset: offset2, size, sha256 }) => ({ offset: offset2, size, sha256 }));
          stage = "save-file-receipt";
          const saved = await api.FieldLibraryFile.update(f.id, { status: complete ? "verified" : "copying", file_uri: multipart ? "" : uploaded.file_uri, chunks, bytes_stored: stored, size: total, mime_type: mime, sha256: multipart ? "" : digest, manifest_sha256: await hash(JSON.stringify(manifest)), verified_at: complete ? at : "", error: "", attempts: (f.attempts || 0) + 1 });
          return { file: publicFile(saved), partial: !complete };
        } catch (e) {
          await api.FieldLibraryFile.update(f.id, { status: "error", error: e.publicMessage || "File transfer interrupted.", attempts: (f.attempts || 0) + 1 });
          throw e;
        }
      };
      if (action === "copy_file") return json(await copyFile(input.file_id));
      if (action === "copy_files") {
        const ids = input.file_ids;
        if (!Array.isArray(ids) || !ids.length || ids.length > 8 || new Set(ids).size !== ids.length) fail("Choose one to eight distinct files.");
        ids.forEach(id);
        const results = await parallel(ids, async (fileId) => {
          try {
            return { file_id: fileId, ...await copyFile(fileId) };
          } catch (e) {
            return { file_id: fileId, error: e.publicMessage || "File transfer interrupted. Retry this file.", status: e.status || e.response?.status || 500 };
          }
        }, 2);
        return json({ results });
      }
      if (action === "audit_import") {
        stage = "audit-import";
        const run = await runFor();
        const [projects, reports, files] = await Promise.all([all(api.FieldLibraryProject, { import_run_id: run.id }), all(api.FieldLibraryReport, { import_run_id: run.id }), all(api.FieldLibraryFile, { import_run_id: run.id })]);
        const imported = new Set(projects.map((p) => p.source_project_id)), missingProjects = run.project_ids.filter((pid) => !imported.has(pid));
        const missingReports = projects.filter((p) => reports.filter((r) => r.source_project_id === p.source_project_id).length !== p.report_count).map((p) => p.source_project_id);
        const missingFileRecords = projects.filter((p) => files.filter((f) => f.source_project_id === p.source_project_id).length < p.attachment_count).map((p) => p.source_project_id);
        const pending = files.filter((f) => f.status !== "verified"), sourceComplete = !missingProjects.length && !missingReports.length && !missingFileRecords.length;
        const complete = sourceComplete && !pending.length, phase = complete ? "complete" : sourceComplete ? "files" : "metadata";
        const audit = { missing_projects: missingProjects, report_count_mismatches: missingReports, file_record_mismatches: missingFileRecords, unverified_files: pending.length, failed_files: pending.filter((f) => f.status === "error").length, deleted_projects: projects.filter((p) => p.source_deleted).length, archived_projects: projects.filter((p) => p.archived).length, deleted_reports: reports.filter((p) => p.source_deleted).length, source_attachment_count: projects.reduce((n, p) => n + p.attachment_count, 0) };
        const saved = await api.FieldLibraryImport.update(run.id, { phase, checked_at: at, projects_checked: projects.length, reports_imported: reports.length, files_discovered: files.length, files_verified: files.length - pending.length, bytes_verified: files.reduce((n, f) => n + (f.status === "verified" ? f.size || 0 : 0), 0), source_complete: sourceComplete, files_complete: complete, audit });
        const { source_snapshot, project_ids, ...view } = saved;
        return json({ run: view });
      }
      if (action === "status") {
        const run = (await api.FieldLibraryImport.list("-created_date", 1))[0];
        if (!run) return json({ run: null });
        const { source_snapshot, project_ids, ...view } = run;
        return json({ run: view });
      }
      if (action === "projects") {
        const term = escapeRegex(input.search), query = { ...input.include_deleted ? {} : { source_deleted: false }, ...term ? { name: { $regex: term, $options: "i" } } : {} };
        const rows = await api.FieldLibraryProject.filter(query, "name", 51, Math.max(0, Number(input.offset) || 0));
        return json({ projects: rows.slice(0, 50).map(({ source_snapshot, ...p }) => p), has_more: rows.length > 50 });
      }
      if (action === "project") {
        const p = await api.FieldLibraryProject.get(id(input.project_id));
        if (!p) fail("Project not found.", 404);
        const [rows, files] = await Promise.all([api.FieldLibraryReport.filter({ library_project_id: p.id, ...input.include_deleted ? {} : { source_deleted: false } }, "-source_created_at", 51, Math.max(0, Number(input.offset) || 0)), all(api.FieldLibraryFile, { source_project_id: p.source_project_id })]);
        const { source_snapshot, ...project } = p;
        return json({ project, reports: rows.slice(0, 50).map((r) => reportView(r, files)), has_more: rows.length > 50 });
      }
      if (action === "file") {
        const f = (await api.FieldLibraryFile.filter({ source_key: String(input.source_key || "").slice(0, 800) }, "-created_date", 1))[0];
        if (!f || f.status !== "verified" || !f.file_uri && !f.chunks?.length) fail("This attachment has not finished transferring.", 409);
        const chunks = f.file_uri ? [] : await parallel(f.chunks, async (c) => ({ url: await signed(c.file_uri), offset: c.offset, size: c.size, sha256: c.sha256 }), 3);
        return json({ file: publicFile(f), url: f.file_uri ? await signed(f.file_uri) : null, chunks, name: displayName(f), mime_type: f.mime_type, size: f.size, sha256: f.sha256, manifest_sha256: f.manifest_sha256 });
      }
      if (action === "report") {
        const r = await api.FieldLibraryReport.get(id(input.report_id));
        if (!r) fail("Report not found.", 404);
        const files = await all(api.FieldLibraryFile, { source_project_id: r.source_project_id, source_post_id: r.source_post_id });
        return json({ report: reportView(r, files) });
      }
      fail("Unsupported action.");
    } catch (error) {
      if (error.publicMessage) return json({ error: error.publicMessage }, error.status || 400);
      console.error("Field library failed", error?.name || "Error");
      return json({ error: "The library request could not finish at " + stage + ". " + String(error?.response?.status || error?.status || "") + " " + (Number(error?.response?.status || error?.status) === 429 ? "The service is busy; retry shortly." : "Retrying preserves imported records.") }, 500);
    }
  };
}

// base44/shared/probuildRefresh.js
var TEAM2 = "-O7aXXhvthc41u60Koc6";
var DB2 = "https://probuild-prod.firebaseio.com/teams/" + TEAM2;
var OWNERS2 = /* @__PURE__ */ new Set(["gabefronk@gmail.com", "gabriel.fronk.wd@gmail.com"]);
var ID2 = /^[A-Za-z0-9_-]{1,160}$/;
var entries2 = (v) => v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v).filter(([, x]) => x && typeof x === "object") : [];
var sourceKey2 = (...parts) => ["probuild", TEAM2, ...parts].join(":");
var sha = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
var fail2 = (code, status = 400) => {
  throw Object.assign(Error(code), { safeCode: code, status });
};
var json2 = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
var iso2 = (v) => {
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
var date2 = (v) => iso2(v) ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso2(v))) : null;
var validId = (v) => typeof v === "string" && ID2.test(v) ? v : fail2("invalid_identifier");
var publicRun = (r) => {
  const { current_plan, ...result } = r;
  return { ...result, scope: "targeted_posts", history_complete: false };
};
async function all2(entity, query) {
  const rows = [];
  for (let skip = 0; skip < 1e4; skip += 500) {
    const page = await entity.filter(query, "id", 500, skip);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  fail2("record_limit", 409);
}
function normalizeTargets(targets) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 10) fail2("choose_one_to_ten_projects");
  const normalized = targets.map((t) => ({ project_id: validId(t.project_id), post_ids: [...new Set((Array.isArray(t.post_ids) ? t.post_ids : []).map(validId))].sort() })).sort((a, b) => a.project_id.localeCompare(b.project_id));
  if (normalized.some((t) => !t.post_ids.length) || normalized.reduce((n, t) => n + t.post_ids.length, 0) > 100 || new Set(normalized.map((t) => t.project_id)).size !== normalized.length) fail2("invalid_post_targets");
  return normalized;
}
function createProbuildRefreshHandler({ getClient, getToken, copyFile, fetchImpl = fetch, now = () => /* @__PURE__ */ new Date() }) {
  const busy = /* @__PURE__ */ new Set();
  return async (req) => {
    if (req.method !== "POST") return json2({ error: "use_post" }, 405);
    let run, api, input, lock;
    try {
      const client = await getClient(req), user = await client.auth.me().catch(() => null);
      if (user?.role !== "admin" || !OWNERS2.has(String(user.email || "").toLowerCase().trim())) return json2({ error: "owner_access_required" }, 403);
      api = client.asServiceRole.entities;
      const raw = await req.text();
      if (raw.length > 5e4) fail2("request_too_large", 413);
      try {
        input = JSON.parse(raw);
      } catch {
        fail2("invalid_json");
      }
      const at = now().toISOString();
      let tokenPromise;
      const token = () => tokenPromise ||= getToken(client);
      const provider = async (path) => {
        const response = await fetchImpl(DB2 + "/" + path + ".json?auth=" + encodeURIComponent(await token()), { signal: AbortSignal.timeout(45e3) });
        if (!response.ok) fail2("source_http_" + response.status, 502);
        const data = await response.json();
        if (data !== null && (typeof data !== "object" || Array.isArray(data))) fail2("invalid_source_payload", 502);
        return data;
      };
      if (input.action === "probe_file") {
        const f = await api.FieldLibraryFile.get(validId(input.file_id));
        if (!f) fail2("file_not_found", 404);
        const p = await provider("projects/" + validId(f.source_project_id));
        if (!p) fail2("source_project_unavailable", 404);
        const post = await provider("posts/" + f.source_project_id + "/" + validId(f.source_post_id));
        const a = post?.attachments?.[validId(f.source_attachment_id)];
        if (!a) fail2("source_attachment_unavailable", 404);
        if (String(a.generation || "") !== String(f.generation || "")) fail2("source_generation_changed", 409);
        const path = `teams/${TEAM2}/posts/${f.source_project_id}/${f.source_post_id}/attachments/${f.source_attachment_id}`;
        const url = "https://firebasestorage.googleapis.com/v0/b/probuild-prod.appspot.com/o/" + encodeURIComponent(path) + "?alt=media" + (f.generation ? "&generation=" + encodeURIComponent(f.generation) : "");
        const response = await fetchImpl(url, { headers: { Authorization: "Firebase " + await token(), Range: "bytes=0-0" }, signal: AbortSignal.timeout(45e3) });
        const range = /^bytes 0-0\/(\d+)$/.exec(response.headers.get("content-range") || "");
        await response.body?.cancel();
        if (response.status !== 206 || !range) fail2("source_range_not_verified", 502);
        const total = Number(range[1]);
        return json2({ file_id: f.id, checked_at: at, source_generation: f.generation, source_bytes: total, declared_bytes: Number(a.fileMetadata?.sizeInBytes) || 0, stored_bytes: f.size, stored_status: f.status, matches_stored: total === f.size, mime_type: response.headers.get("content-type") || null });
      }
      if (input.action === "start") {
        const targets = normalizeTargets(input.targets), requestKey = validId(input.request_key);
        const runKey = await sha(requestKey + ":" + JSON.stringify(targets));
        const prior = (await api.ProbuildRefreshRun.filter({ run_key: runKey }, "-created_date", 1))[0];
        if (prior) return json2({ run: publicRun(prior), resumed: true });
        const projects = await provider("projects");
        if (targets.some((t) => !projects?.[t.project_id])) fail2("target_outside_accessible_projects", 403);
        run = await api.ProbuildRefreshRun.create({ run_key: runKey, scope: "targeted_posts", history_complete: false, targets, status: "metadata", phase: "metadata", cursor: 0, attempts: 0, next_retry_at: null, started_at: at, checked_at: at, completed_at: null, source_complete: false, writes_complete: false, assets_complete: false, file_ids: [], results: [], errors: [], issues: [], counts: { target_projects: targets.length, target_posts: targets.reduce((n, t) => n + t.post_ids.length, 0), declared_attachments: 0, verified_assets: 0 }, current_plan: null });
        return json2({ run: publicRun(run) });
      }
      if (input.action === "status") {
        run = input.run_id ? await api.ProbuildRefreshRun.get(validId(input.run_id)) : (await api.ProbuildRefreshRun.list("-created_date", 1))[0];
        return json2({ run: run ? publicRun(run) : null });
      }
      if (input.action !== "next") fail2("unsupported_action");
      run = await api.ProbuildRefreshRun.get(validId(input.run_id));
      if (!run) fail2("run_not_found", 404);
      if (run.status === "complete" || run.status === "failed") return json2({ run: publicRun(run) });
      if (input.cursor !== run.cursor || input.phase !== run.phase) return json2({ run: publicRun(run), stale_request: true });
      if (run.next_retry_at && Date.parse(at) < Date.parse(run.next_retry_at)) return json2({ run: publicRun(run), retry_after: run.next_retry_at }, 429);
      if (busy.has(run.id)) return json2({ error: "run_busy", run: publicRun(run) }, 409);
      lock = run.id;
      busy.add(lock);
      const save = async (patch) => {
        run = await api.ProbuildRefreshRun.update(run.id, { ...patch, checked_at: at });
        return run;
      };
      if (run.phase === "metadata") {
        const target = run.targets[run.cursor];
        if (!target) fail2("invalid_cursor", 409);
        if (!run.current_plan) {
          const p = await provider("projects/" + target.project_id);
          if (!p) fail2("source_project_unavailable", 502);
          const posts = await provider("posts/" + target.project_id);
          if (target.post_ids.some((pid) => !posts?.[pid])) fail2("requested_post_absent_review_required", 409);
          const oldProject = await api.FieldLibraryProject.filter({ source_key: sourceKey2(target.project_id) }, "id", 2);
          if (oldProject.length > 1) fail2("duplicate_project_identity", 409);
          const project2 = oldProject[0], priorReports = await all2(api.FieldLibraryReport, { source_project_id: target.project_id }), priorFiles = await all2(api.FieldLibraryFile, { source_project_id: target.project_id });
          if (new Set(priorReports.map((r) => r.source_key)).size !== priorReports.length || new Set(priorFiles.map((f) => f.source_key)).size !== priorFiles.length) fail2("duplicate_library_identity", 409);
          const revisions = [], reportRows = [], fileRows = [], issues = [];
          let created = 0, edited = 0, unchanged = 0, deleted = 0;
          const revision = async (key, snapshot) => {
            if (snapshot) revisions.push({ revision_key: await sha(key + ":" + await sha(JSON.stringify(snapshot))), source_key: key, source_hash: await sha(JSON.stringify(snapshot)), source_snapshot: snapshot, observed_at: at, run_id: run.id });
          };
          await revision(sourceKey2(target.project_id), project2?.source_snapshot);
          await revision(sourceKey2(target.project_id), p);
          for (const pid of target.post_ids) {
            const post = posts[pid], key = sourceKey2(target.project_id, pid), old = priorReports.find((r) => r.source_key === key), digest = await sha(JSON.stringify(post));
            if (!old) created++;
            else if (old.source_hash !== digest) edited++;
            else unchanged++;
            if (post.deletedAt) deleted++;
            await revision(key, old?.source_snapshot);
            await revision(key, post);
            const attachments = [];
            for (const [aid, a] of entries2(post.attachments)) {
              validId(aid);
              const generation = String(a.generation || ""), fkey = sourceKey2(target.project_id, pid, aid, generation), prior = priorFiles.find((f) => f.source_key === fkey);
              const name = a.fileMetadata?.name || a.documentName || `${aid}.${a.type === "photo" ? "jpg" : "bin"}`, mime = a.mimeType || (a.type === "photo" ? "image/jpeg" : "application/octet-stream");
              fileRows.push({ source_key: fkey, source_project_id: target.project_id, source_post_id: pid, source_attachment_id: aid, generation, name, mime_type: prior?.status === "verified" ? prior.mime_type : mime, source_type: a.type || "", source_snapshot: a, source_deleted: !!post.deletedAt || !!a.deletedAt, status: prior?.status === "verified" ? "verified" : prior?.status || "pending", source_size: Number(a.fileMetadata?.sizeInBytes) || 0 });
              attachments.push({ id: aid, type: a.type || "", generation, name, mime_type: mime, source_key: fkey, size: Number(a.fileMetadata?.sizeInBytes) || 0 });
            }
            const keys = new Set(attachments.map((a) => a.source_key));
            const removed = priorFiles.filter((f) => f.source_post_id === pid && !keys.has(f.source_key));
            if (removed.length) issues.push({ code: "prior_attachment_not_in_current_post", project_id: target.project_id, post_id: pid, count: removed.length });
            reportRows.push({ source_key: key, source_project_id: target.project_id, source_post_id: pid, project_name: p.name || p.title || target.project_id, report_date: date2(post.createdAt), source_created_at: iso2(post.createdAt), source_deleted: !!post.deletedAt, message: post.message || "", source_snapshot: post, source_hash: digest, source_checked_at: at, attachments });
          }
          if (fileRows.length > 1e3 || JSON.stringify({ revisions, reportRows, fileRows }).length > 15e5) fail2("target_payload_limit", 409);
          const projectRow = { source_key: sourceKey2(target.project_id), source_project_id: target.project_id, name: p.name || p.title || target.project_id, description: p.description || "", archived: !!p.archivedAt, source_deleted: !!p.deletedAt, source_snapshot: p, source_hash: await sha(JSON.stringify(p)), source_checked_at: at, report_count: entries2(posts).length, attachment_count: entries2(posts).reduce((n, [, post]) => n + entries2(post.attachments).length, 0) };
          await save({ current_plan: { projectRow, revisions, reportRows, fileRows, issues, counts: { created, edited, unchanged, deleted, declared_attachments: fileRows.length } }, status: "metadata" });
        }
        const plan = run.current_plan;
        for (const revision of plan.revisions) {
          if (!(await api.ProbuildSourceRevision.filter({ revision_key: revision.revision_key }, "id", 1))[0]) await api.ProbuildSourceRevision.create(revision);
        }
        const upsert = async (entity, row) => {
          const found = await entity.filter({ source_key: row.source_key }, "id", 2);
          if (found.length > 1) fail2("duplicate_library_identity", 409);
          return found[0] ? entity.update(found[0].id, row) : entity.create(row);
        };
        const project = await upsert(api.FieldLibraryProject, plan.projectRow);
        for (const report of plan.reportRows) await upsert(api.FieldLibraryReport, { ...report, library_project_id: project.id });
        const fileIds = [];
        for (const file of plan.fileRows) {
          const latest = await api.FieldLibraryFile.filter({ source_key: file.source_key }, "id", 2);
          if (latest.length > 1) fail2("duplicate_library_identity", 409);
          const row = latest[0]?.status === "verified" ? { ...file, status: "verified", mime_type: latest[0].mime_type } : file;
          fileIds.push((await upsert(api.FieldLibraryFile, row)).id);
        }
        const cursor = run.cursor + 1, done = cursor === run.targets.length;
        const result = { project_id: target.project_id, checked_at: at, source_complete: true, writes_complete: true, ...plan.counts };
        await save({ cursor: done ? 0 : cursor, phase: done ? "files" : "metadata", status: done ? "files" : "metadata", source_complete: done, writes_complete: done, attempts: 0, next_retry_at: null, current_plan: null, results: [...run.results, result], file_ids: [.../* @__PURE__ */ new Set([...run.file_ids, ...fileIds])], issues: [...run.issues, ...plan.issues], counts: { ...run.counts, declared_attachments: run.counts.declared_attachments + plan.counts.declared_attachments } });
      } else if (run.phase === "files") {
        const files = [];
        for (const fileId of run.file_ids) files.push(await api.FieldLibraryFile.get(fileId));
        const verified = files.filter((f) => f?.status === "verified" && f.verified_at && (f.file_uri && f.sha256 || f.chunks?.length && f.manifest_sha256 && f.bytes_stored === f.size));
        const pending = files.filter((f) => !verified.includes(f));
        if (pending.length) {
          const f = pending[0];
          if (!f) fail2("file_record_missing", 409);
          const before = Number(f.bytes_stored) || 0;
          const outcome = await copyFile(req, f.id);
          if (!outcome || outcome.error) fail2("asset_copy_failed", 502);
          const after = await api.FieldLibraryFile.get(f.id);
          if (after?.status !== "verified" && (Number(after?.bytes_stored) || 0) <= before) fail2("asset_copy_no_progress", 502);
          await save({ status: "files", attempts: 0, next_retry_at: null, counts: { ...run.counts, verified_assets: verified.length }, cursor: run.cursor + 1 });
        } else {
          await save({ status: "complete", assets_complete: true, completed_at: at, attempts: 0, next_retry_at: null, counts: { ...run.counts, verified_assets: verified.length } });
        }
      } else fail2("invalid_phase", 409);
      return json2({ run: publicRun(run) });
    } catch (error) {
      const code = error.safeCode || "refresh_step_failed";
      if (run && api && input?.action === "next" && !["complete", "failed"].includes(run.status)) {
        const attempts = (run.attempts || 0) + 1, failed = attempts >= 3;
        const at = now().toISOString();
        try {
          run = await api.ProbuildRefreshRun.update(run.id, { status: failed ? "failed" : "retry_wait", attempts, next_retry_at: failed ? null : new Date(Date.parse(at) + [3e4, 12e4][attempts - 1]).toISOString(), checked_at: at, errors: [...run.errors || [], { code, at, phase: run.phase, cursor: run.cursor, attempt: attempts }] });
        } catch {
          return json2({ error: "run_receipt_write_failed", run_id: run.id }, 503);
        }
        return json2({ error: code, run: publicRun(run) }, error.status || 502);
      }
      return json2({ error: code }, error.status || 502);
    } finally {
      if (lock) busy.delete(lock);
    }
  };
}

// base44/functions/probuild-refresh/entry.ts
var dependencies = { getClient: async (req) => createClientFromRequest(req), getToken: getProbuildIdToken };
var library = createFieldLibraryHandler(dependencies);
var handler = createProbuildRefreshHandler({ ...dependencies, copyFile: async (req, fileId) => {
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  const result = await library(new Request(req.url, { method: "POST", headers, body: JSON.stringify({ action: "copy_file", file_id: fileId }) }));
  const data = await result.json();
  if (!result.ok || data.error) throw Error("asset_copy_failed");
  return data;
} });
Deno.serve(handler);

// Private quote-ingest endpoint for the Purchasing page dropzone. Authenticates
// the caller's auth user id BEFORE any file/entity/provider read. The source PDF
// is uploaded client-side via UploadPrivateFile (private ref, no public URL); this
// function signs a short-lived fetch URL server-side only when the reader or owner
// needs it. The signed URL is never persisted, logged, or returned by ingest/refresh.
// sign_source is the one owner-gated explicit-click action that returns a short
// review link. The handler logic lives in the injectable, SDK-free
// base44/shared/purchasingQuoteIngestHandle.js so it can be tested with a mock.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { handle, QUOTE_SCHEMA, QUOTE_PROMPT } from '../../shared/purchasingQuoteIngestHandle.js';

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function (req) {
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  const core = base44.asServiceRole.integrations.Core;
  const adapter = {
    authMe: () => base44.auth.me(),
    jobsGet: (id) => db.Jobs.get(id),
    budgetGet: (id) => db.JobBudgets.get(id),
    budgetCreate: (data) => db.JobBudgets.create(data),
    budgetUpdate: (id, patch) => db.JobBudgets.update(id, patch),
    budgetFilter: (q, sort, limit) => db.JobBudgets.filter(q, sort, limit),
    signUrl: (file_uri, expires_in) => core.CreateFileSignedUrl({ file_uri, expires_in }),
    sha256: sha256Bytes,
    // Stream the signed URL with a hard size cap so a runaway file never loads fully.
    fetchBytes: async (signedUrl, maxBytes) => {
      const r = await fetch(signedUrl, { signal: AbortSignal.timeout(60000), cache: 'no-store' });
      if (!r.ok) throw new Error('pdf_fetch_failed');
      const declared = Number(r.headers.get('content-length') || 0);
      if (declared && declared > maxBytes) throw new Error('pdf_too_large');
      const reader = r.body.getReader();
      const parts = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) { await reader.cancel(); throw new Error('pdf_too_large'); }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!size) throw new Error('pdf_fetch_failed');
      const bytes = new Uint8Array(size);
      let off = 0;
      for (const p of parts) { bytes.set(p, off); off += p.length; }
      return { bytes, size, sha256: await sha256Bytes(bytes) };
    },
    invokeReader: (signedUrl) => core.InvokeLLM({
      prompt: QUOTE_PROMPT,
      response_json_schema: QUOTE_SCHEMA,
      file_urls: [signedUrl],
      add_context_from_internet: false,
    }),
  };
  const { status, body } = await handle(req, adapter);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
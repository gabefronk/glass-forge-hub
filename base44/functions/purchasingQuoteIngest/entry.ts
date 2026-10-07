// Private quote-ingest endpoint for the Purchasing page. Owner-ID auth runs in the
// handler before any read. The server uploads the owner's PDF bytes itself and
// records a server-only receipt; only receipt refs are ever signed. Signed URLs
// stay in memory for one capped fetch + one reader call. No logging.
// Entities use the SDK options form: filter(query, { sort, limit }) → EntityPage.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { handle, QUOTE_SCHEMA, QUOTE_PROMPT } from '../../shared/purchasingQuoteIngestHandle.js';

async function fetchBytes(signedUrl: string, maxBytes: number) {
  const r = await fetch(signedUrl, { signal: AbortSignal.timeout(60000), cache: 'no-store', redirect: 'error' }).catch(() => null);
  if (!r || !r.ok || !r.body) return { error: 'pdf_fetch_failed' };
  if (Number(r.headers.get('content-length') || 0) > maxBytes) return { error: 'pdf_too_large' };
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); return { error: 'pdf_too_large' }; }
      parts.push(value);
    }
  } catch {
    return { error: 'pdf_fetch_failed' };
  }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const p of parts) { bytes.set(p, off); off += p.length; }
  return { bytes, contentType: r.headers.get('content-type') || '' };
}

export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  const core = base44.asServiceRole.integrations.Core;
  const adapter = {
    authMe: () => base44.auth.me(),
    jobsGet: (id: string) => db.Jobs.get(id),
    budgetGet: (id: string) => db.JobBudgets.get(id),
    budgetCreate: (data: Record<string, unknown>) => db.JobBudgets.create(data),
    budgetFilter: (q: Record<string, unknown>, opts: Record<string, unknown>) => db.JobBudgets.filter(q, opts),
    receiptFilter: (q: Record<string, unknown>, opts: Record<string, unknown>) => db.QuoteSourceReceipt.filter(q, opts),
    receiptCreate: (data: Record<string, unknown>) => db.QuoteSourceReceipt.create(data),
    receiptUpdate: (id: string, patch: Record<string, unknown>) => db.QuoteSourceReceipt.update(id, patch),
    uploadPrivate: (bytes: Uint8Array, name: string) => core.UploadPrivateFile({ file: new File([bytes], name, { type: 'application/pdf' }) }),
    signUrl: (file_uri: string, expires_in: number) => core.CreateFileSignedUrl({ file_uri, expires_in }),
    fetchBytes,
    invokeReader: (signedUrl: string) => core.InvokeLLM({ prompt: QUOTE_PROMPT, response_json_schema: QUOTE_SCHEMA, file_urls: [signedUrl], add_context_from_internet: false }),
  };
  const { status, body } = await handle(req, adapter);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
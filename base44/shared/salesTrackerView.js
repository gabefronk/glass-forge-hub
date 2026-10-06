import { parseTracker } from './salesTrackerParser.js';
import { applyTrackerAppends } from './salesTrackerAppend.js';
export const trackerSha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
// cache (optional, read-only callers only): a Map kept by the caller across requests.
// The parsed workbook is reused only for the same validated snapshot id AND sha256,
// so a new or replaced workbook is always downloaded, integrity-checked and parsed.
// Append batches are always re-read, so new Daily Sales rows show up immediately.
export async function readTrackerView(client, XLSX, fetchFile = fetch, cache = null) {
  const api=client.asServiceRole, snapshot=(await api.entities.SalesTrackerSnapshot.filter({status:'validated'},'-source_captured_at',1))[0];
  if(!snapshot) throw Error('Import a complete baseline workbook before appending Daily Sales rows.');
  const cacheKey=snapshot.id+'|'+snapshot.sha256;
  let bytes, base;
  const hit=cache?.get(cacheKey);
  if(hit){ ({bytes,base}=hit); } else {
    const {signed_url}=await api.integrations.Core.CreateFileSignedUrl({file_uri:snapshot.file_uri,expires_in:300});
    if(!signed_url) throw Error('The current workbook is unavailable.');
    const response=await fetchFile(signed_url);
    if(!response.ok) throw Error('The current workbook is unavailable.');
    bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>5000000 || await trackerSha(bytes)!==snapshot.sha256) throw Error('The current workbook integrity check failed.');
    base=parseTracker(XLSX,bytes);
    if(cache){ cache.clear(); cache.set(cacheKey,{bytes,base}); }
  }
  const batches=await api.entities.SalesTrackerAppendBatch.filter({status:'committed'},'imported_at',500);
  if(batches.length>=500) throw Error('The append ledger needs administrative consolidation before it can be read completely.');
  const view=applyTrackerAppends(base.rows,batches);
  return {snapshot,bytes,base,batches,...view};
}

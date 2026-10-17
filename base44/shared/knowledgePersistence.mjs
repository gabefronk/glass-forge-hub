// Frozen private snapshot + reconciled generated-only writes. No source mutations.
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const statusOf=e=>[e?.status,e?.response?.status].find(Number.isInteger)||0;
const transient=e=>[429,408,500,502,503,504].includes(statusOf(e))||['TypeError','TimeoutError','AbortError'].includes(e?.name);
export const safeBuildError=(e,stage)=>({stage,error_code:statusOf(e)===429?'rate_limited':/count mismatch|references mismatch|duplicate|changed|integrity/.test(e?.message||'')?'verification_failed':transient(e)?'transient_transport':'build_step_failed',error_http_status:statusOf(e),last_error_at:new Date().toISOString()});
export async function retryBuildRead(work,{sleep=delay,onRetry=async()=>{}}={}){for(let i=0;;i++){try{return await work();}catch(e){if(!transient(e)||i>=4)throw e;await onRetry(e,i);await sleep(1000*2**i);}}}
export function snapshotStore(api){return{
 save:async plan=>{const bytes=new TextEncoder().encode(JSON.stringify(plan));if(bytes.length>100*1048576)throw Error('Build snapshot exceeds size limit');const hash=await digest(bytes);const r=await api.integrations.Core.UploadPrivateFile({file:new File([bytes],'job-knowledge-build.json',{type:'application/json'})});if(!/^(?:mp\/)?private(?:\/|:\/\/)[^?#\\\s]+$/.test(r.file_uri||''))throw Error('Private snapshot missing');return{snapshot_uri:r.file_uri,snapshot_sha256:hash,snapshot_bytes:bytes.length};},
 load:async run=>{if(!/^(mp\/)?private(\/|:\/\/)/.test(run.snapshot_uri||''))throw Error('Invalid private snapshot');const {signed_url}=await api.integrations.Core.CreateFileSignedUrl({file_uri:run.snapshot_uri,expires_in:300});const r=await fetch(signed_url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Object.assign(Error('Snapshot unavailable'),{status:r.status});const reader=r.body.getReader(),parts=[];let n=0;for(;;){const{done,value}=await reader.read();if(done)break;n+=value.length;if(n>100*1048576){await reader.cancel();throw Error('Snapshot size limit');}parts.push(value);}const bytes=new Uint8Array(n);let p=0;for(const v of parts){bytes.set(v,p);p+=v.length;}if(n!==run.snapshot_bytes||await digest(bytes)!==run.snapshot_sha256)throw Error('Snapshot integrity mismatch');return JSON.parse(new TextDecoder().decode(bytes));}
};}
export async function writeGeneratedBatch(entity,runId,key,rows,{sleep=delay,onRetry=async()=>{}}={}){
 const wanted=new Map(rows.map(r=>[r[key],r]));
 for(let attempt=0;;attempt++){
  const found=await retryBuildRead(()=>entity.filter({run_id:runId,[key]:{$in:[...wanted.keys()]}},'id',rows.length+1),{sleep,onRetry});
  if(found.length>rows.length||new Set(found.map(r=>r[key])).size!==found.length)throw Error('Generated duplicate records');
  // Compare payload, not JSON property order; provider may reorder object keys.
  const same=(a,b)=>b&&typeof b==='object'?Object.keys(b).every(k=>same(a?.[k],b[k])):a===b;
  if(found.some(r=>!wanted.has(r[key])||!same(r,wanted.get(r[key]))))throw Error('Generated records changed');
  const missing=rows.filter(r=>!found.some(x=>x[key]===r[key]));if(!missing.length)return;
  if(attempt>4)throw Object.assign(Error('Generated write retry limit'),{status:503});
  try{await entity.bulkCreate(missing);}catch(e){if(!transient(e))throw e;await onRetry(e,attempt);await sleep(1000*2**attempt);}
 }
}

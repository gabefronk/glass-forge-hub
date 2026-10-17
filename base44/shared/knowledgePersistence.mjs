// Frozen private snapshot + reconciled generated-only writes. No source mutations.
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const serialize=v=>JSON.stringify(canonical(v));
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const statusOf=e=>[e?.status,e?.response?.status].find(Number.isInteger)||0;
const transient=e=>[429,408,500,502,503,504].includes(statusOf(e))||['TypeError','TimeoutError','AbortError'].includes(e?.name);
export const safeBuildError=(e,stage)=>({stage,error_code:statusOf(e)===429?'rate_limited':/count mismatch|references mismatch|duplicate|changed|integrity/.test(e?.message||'')?'verification_failed':transient(e)?'transient_transport':'build_step_failed',error_http_status:statusOf(e),retry_after_seconds:Math.min(3600,Math.max(0,Number(e?.originalError?.response?.headers?.['retry-after']||e?.response?.headers?.['retry-after'])||0)),last_error_at:new Date().toISOString()});
export async function retryBuildRead(work,{sleep=delay,onRetry=async()=>{}}={}){for(let i=0;;i++){try{return await work();}catch(e){if(!transient(e)||i>=4)throw e;await onRetry(e,i);await sleep(1000*2**i);}}}
export function snapshotStore(api){
 const enc=new TextEncoder(),hash=v=>digest(enc.encode(serialize(v)));
 return{
 save:async(plan,progress=async()=>{},options={})=>{
  const text=serialize(plan),parts=[];for(let i=0;i<text.length;i+=900000)parts.push({payload:{text:text.slice(i,i+900000)}});
  let size=0;for(const p of parts){const bytes=enc.encode(serialize(p.payload));size+=bytes.length;if(bytes.length>3*1048576)throw Error('Snapshot part exceeds size limit');p.sha256=await digest(bytes);}
  const sha=await hash(parts.map(p=>p.sha256)),runId=plan.run_id;
  if(!runId)throw Error('Missing snapshot run');
  for(let i=0;i<parts.length;i+=2){
    await progress('save_snapshot_parts',{snapshot_saved_parts:i,snapshot_expected_parts:parts.length,snapshot_bytes:size});
    await writeGeneratedBatch(api.entities.JobKnowledgeBuildPart,runId,'part_key',parts.slice(i,i+2).map((p,j)=>({run_id:runId,snapshot_id:sha,part_key:sha+':'+(i+j),part_index:i+j,...p})),options);
    await (options.sleep||delay)(5000);
  }
  return{snapshot_uri:'entity:'+sha,snapshot_sha256:sha,snapshot_bytes:size,snapshot_saved_parts:parts.length,snapshot_expected_parts:parts.length};
 },
 load:async(run,options={})=>{
  if(run.snapshot_uri!=='entity:'+run.snapshot_sha256||!/^[a-f0-9]{64}$/.test(run.snapshot_sha256||''))throw Error('Snapshot integrity mismatch');
  const parts=await retryBuildRead(()=>api.entities.JobKnowledgeBuildPart.filter({run_id:run.id,snapshot_id:run.snapshot_sha256},'part_index',500),options);
  if(parts.length!==run.snapshot_expected_parts||parts.some((p,i)=>p.part_index!==i))throw Error('Snapshot parts missing or duplicate');
  let size=0;for(const p of parts){const bytes=enc.encode(serialize(p.payload));size+=bytes.length;if(await digest(bytes)!==p.sha256)throw Error('Snapshot integrity mismatch');}
  if(size!==run.snapshot_bytes||await hash(parts.map(p=>p.sha256))!==run.snapshot_sha256)throw Error('Snapshot integrity mismatch');
  const plan=JSON.parse(parts.map(p=>p.payload.text).join(''));if(plan.run_id!==run.id)throw Error('Snapshot run integrity mismatch');return plan;
 }
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

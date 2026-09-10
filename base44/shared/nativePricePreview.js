import { HttpError, sha256 } from './windowQuotesCore.js';
import { buildQuotePlan, assertSupportedPlan } from './amscoQuotePlan.js';
import { nativeEnginePolicyReady, nativeEnginePresenceReady, verifyDesktopNativeQuote, validateNativeEngineProof, desktopNativeIdentityIssues } from './nativeEngineObservation.js';
import { CATALOG_SUPPORT_ID, buildNativeCatalogPlan, assertNativeCatalogPlan } from './nativeCatalogPlan.js';
import { verifyCatalogObservedQuote } from './nativeCatalogObservation.js';

const stable = value => JSON.stringify(value, (_key,item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const clone = value => structuredClone(value);
const fail = (status,message) => { throw new HttpError(status,message); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const hashValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
const pendingMs = 10 * 60 * 1000, cacheMs = 24 * 60 * 60 * 1000, leaseMs = 180000;
export const PREVIEW_VERSION = 1;
export const previewPolicyKey = policy => ({version:policy.version,contract_hash:policy.contract_hash,catalog_id:policy.catalog_id,context_fingerprint:policy.context_fingerprint});

export function planNativePricePreview(quote) {
 const legacy=buildQuotePlan(quote);if(legacy.ok)return legacy;
 const settings={...quote.settings};
 if(settings.low_e===true&&!settings.glass)settings.glass='CozE (LowE)';
 if(settings.low_e===false&&!settings.glass)return legacy;
 delete settings.low_e;
 return buildNativeCatalogPlan({...quote,settings});
}
export const assertNativePricePreviewPlan=plan=>plan?.support_id===CATALOG_SUPPORT_ID?assertNativeCatalogPlan(plan):assertSupportedPlan(plan);
export async function verifyNativePricePreview(plan,observed,context) {
 if(plan.support_id!==CATALOG_SUPPORT_ID)return verifyDesktopNativeQuote(plan,observed,context);
 const proof=await validateNativeEngineProof(plan,observed,context);if(!proof.ok)return proof;
 const checked=verifyCatalogObservedQuote(plan,observed,{validateIdentity:desktopNativeIdentityIssues});if(!checked.ok)return checked;
 return {ok:true,result:{...checked.result,native_source:'desktop_native',native_engine:clone(observed.native_engine),verification:{...checked.result.verification,source:'desktop_native',dimension_source:'saved_native_frame',persistence:'navigator_local'}}};
}

// Private transient native calculations. There is no customer QuoteRequest,
// online quote creation, order, customer submission or model-generated price.
export function createNativePricePreviewService({config, now=()=>new Date(), hash=sha256, normalize=planNativePricePreview, verify=verifyNativePricePreview}={}) {
 const policy=config?.native_engine, at=()=>now().toISOString(), stamp=()=>now().getTime();
 const digest=value=>hash(stable(value));
 const enabled=config?.enabled===true && config.mode==='queue' && policy?.price_previews===true && nativeEnginePolicyReady(policy);
 const context=()=>previewPolicyKey(policy);
 const inContext=row=>row?.contract_hash===policy?.contract_hash && row?.context_fingerprint===policy?.context_fingerprint && row?.catalog_id===policy?.catalog_id;
 const workerGuard=worker=>{
  if(!enabled)fail(503,'Native price previews are unavailable');
  if(worker?.id!==config.worker_id||worker.enabled!==true||worker.token_hash!==config.worker_key_hash||!worker.allowed_dealers?.includes('BFS'))fail(401,'Runner authentication failed');
 };
 const rows=db=>db.WindowQuotePricePreviews;
 const get=async(db,previewId)=>{if(!id(previewId))fail(400,'Invalid price preview ID');const found=await rows(db).filter({id:previewId},undefined,2);if(found.length!==1)fail(404,'Price preview not found');return found[0];};
 async function planFor(row){
  if(!inContext(row)||!hashValue(row.plan_hash)||row.plan?.quote_id!==row.id||row.plan?.input_revision!==1||row.plan?.lines?.length!==1)fail(409,'Price preview context changed');
  const checked=assertNativePricePreviewPlan(row.plan);
  if(!checked.ok||await digest(checked.plan)!==row.plan_hash||await digest(row.plan)!==row.plan_hash)fail(409,'Price preview plan changed');
  return row.plan;
 }
 const live=row=>Number.isFinite(Date.parse(row.expires_at))&&Date.parse(row.expires_at)>stamp();
 async function currentWorker(db){
  if(!enabled)return false;
  const matches=await db.QuoteWorkers.filter({id:config.worker_id,enabled:true,token_hash:config.worker_key_hash},undefined,2);
  if(matches.length!==1||!matches[0].allowed_dealers?.includes('BFS'))return false;
  const presence=matches[0].runner_presence, age=stamp()-Date.parse(presence?.last_seen_at);
  return age>=0&&age<100000&&!['attention','stopping'].includes(presence.runner_status)&&nativeEnginePresenceReady(presence.native_engine,policy);
 }
 function publicResult(row,qty){
  if(!inContext(row))return {status:'native_unavailable'};
  if(row.status==='ready'&&live(row)){
   const result=row.result, line=result?.lines?.[0];
   if(result?.verified!==true||!nativeEnginePresenceReady({state:'ready',...result.native_engine},policy)||!line||line.qty!==1||result.input_revision!==1||result.native_source!=='desktop_native')return {status:'native_unavailable'};
   const unit=line.unit_prices;
   if(!['list','dealer','customer'].every(k=>typeof unit?.[k]==='number'&&Number.isFinite(unit[k])&&unit[k]>0))return {status:'native_unavailable'};
   return {status:'priced',price_source:'native_live',unit_prices:clone(unit),line_totals:Object.fromEntries(['list','dealer','customer'].map(k=>[k,money(unit[k]*qty)])),checked_at:result.verification?.checked_at,preview_id:row.id};
  }
  if(row.status==='unsupported')return {status:'amsco_lookup_needed',preview_id:row.id,questions:['These selections need AMSCO online configuration.']};
  if(row.status==='failed'||!live(row)||row.status==='running'&&Date.parse(row.lease_expires_at)<=stamp())return {status:'native_unavailable',preview_id:row.id};
  return {status:'calculating',preview_id:row.id,retry_after_ms:2000};
 }
 async function request({db,user,line,settings,sessionId}){
  if(user?.role!=='admin'||!id(user.id))fail(403,'An authenticated administrator is required');
  if(!enabled)return {status:'native_unavailable'};
  if(sessionId!==undefined&&!id(sessionId))fail(400,'Invalid preview session');
  const input={settings:clone(settings),lines:[{...clone(line),qty:1,room:''}]};
  delete input.lines[0].id;delete input.lines[0].mark;delete input.lines[0].source_reference;
  const built=normalize({...input,id:'price-preview',input_revision:1});
  if(!built.ok)return {status:'amsco_lookup_needed'};
  const requestKey=await digest({version:PREVIEW_VERSION,owner:user.id,context:context(),plan:{...built.plan,quote_id:'price-preview',title:''}});
  if(sessionId&&id(line.id))await rows(db).updateMany({owner_id:user.id,session_id:sessionId,line_key:line.id,status:{$in:['preparing','queued']},request_key:{$ne:requestKey}},{$set:{status:'superseded',expires_at:at()}});
  const matches=await rows(db).filter({request_key:requestKey,owner_id:user.id},'-created_date',10);
  const available=matches.filter(r=>inContext(r)&&live(r));
  const existing=available.find(r=>r.status==='ready')||available.find(r=>['queued','running','unsupported','failed'].includes(r.status));
  if(existing)return publicResult(existing,line.qty);
  if(!await currentWorker(db))return {status:'native_unavailable'};
  // Bound active edits per person; reused keys do not consume another slot.
  const outstanding=await rows(db).filter({owner_id:user.id,status:{$in:['preparing','queued','running']},expires_at:{$gt:at()}},undefined,30);
  if(outstanding.length>=25)return {status:'native_busy',retry_after_ms:3000};
  let row=await rows(db).create({version:PREVIEW_VERSION,owner_id:user.id,request_key:requestKey,status:'preparing',...context(),...(sessionId&&id(line.id)?{session_id:sessionId,line_key:line.id}:{}),created_at:at(),expires_at:new Date(stamp()+pendingMs).toISOString()});
  const plan=normalize({...input,id:row.id,input_revision:1});if(!plan.ok)fail(409,'Price preview inputs changed');
  const patch={status:'queued',plan:plan.plan,plan_hash:await digest(plan.plan),queued_at:at()};
  const changed=await rows(db).updateMany({id:row.id,status:'preparing'},{$set:patch});if(changed.updated!==1)fail(409,'Price preview changed');
  row={...row,...patch};return publicResult(row,line.qty);
 }
 async function poll({db,worker,nativeReady,excludedIds=[]}){
  if(!enabled)return null;workerGuard(worker);if(!nativeReady)return null;
  if(!Array.isArray(excludedIds)||excludedIds.length>100||excludedIds.some(value=>!id(value)))fail(400,'Invalid completed-preview list');
  const candidates=await rows(db).filter({status:'queued',contract_hash:policy.contract_hash,context_fingerprint:policy.context_fingerprint,expires_at:{$gt:at()},...(excludedIds.length?{id:{$nin:excludedIds}}:{})},'queued_at',10);
  for(const row of candidates){
   const plan=await planFor(row);
   return {kind:'price_preview',quote_id:row.id,input_revision:1,plan_hash:row.plan_hash,plan:clone(plan)};
  }
  return null;
 }
 async function claim({db,worker,body}){
  workerGuard(worker);
  if(Object.keys(body).some(k=>!['action','preview_id','operation_id','plan_hash'].includes(k))||!id(body.operation_id)||!hashValue(body.plan_hash))fail(400,'Invalid preview claim');
  let row=await get(db,body.preview_id);await planFor(row);
  if(row.plan_hash!==body.plan_hash||!live(row))fail(409,'Price preview is no longer available');
  if(row.status==='running'&&row.operation_id===body.operation_id&&row.worker_id===worker.id&&Date.parse(row.lease_expires_at)>stamp())return {ok:true,preview_id:row.id,operation_id:row.operation_id,lease_expires_at:row.lease_expires_at,plan_hash:row.plan_hash};
  if(row.status!=='queued')fail(409,'Price preview is already claimed');
  const patch={status:'running',worker_id:worker.id,operation_id:body.operation_id,started_at:at(),lease_expires_at:new Date(stamp()+leaseMs).toISOString()};
  const changed=await rows(db).updateMany({id:row.id,status:'queued',plan_hash:row.plan_hash},{$set:patch});if(changed.updated!==1)fail(409,'Price preview was claimed elsewhere');
  return {ok:true,preview_id:row.id,operation_id:body.operation_id,lease_expires_at:patch.lease_expires_at,plan_hash:row.plan_hash};
 }
 async function report({db,worker,body}){
  workerGuard(worker);
  if(Object.keys(body).some(k=>!['action','preview_id','operation_id','plan_hash','status','observed'].includes(k))||!id(body.operation_id)||!hashValue(body.plan_hash)||!['ready','unsupported','failed'].includes(body.status)||body.status!=='ready'&&body.observed!==undefined)fail(400,'Invalid price preview report');
  const row=await get(db,body.preview_id);await planFor(row);
  if(row.worker_id!==worker.id||row.operation_id!==body.operation_id||row.plan_hash!==body.plan_hash)fail(409,'Price preview claim differs');
  const reportHash=await digest(body);
  if(['ready','unsupported','failed'].includes(row.status)){
   if(row.report_hash!==reportHash)fail(409,'A different price preview result was already saved');
   return {ok:true,status:row.status,preview_id:row.id};
  }
  if(row.status!=='running'||Date.parse(row.lease_expires_at)<=stamp())fail(409,'Price preview lease expired');
  let result;
  if(body.status==='ready'){
   const checked=await verify(row.plan,body.observed,{policy,operationId:row.operation_id,startedAt:row.started_at,now:now()});
   if(!checked.ok)fail(400,'The native preview does not match its requested configuration and saved pricing');
   result=checked.result;
  }
  const patch={status:body.status,report_hash:reportHash,completed_at:at(),expires_at:new Date(stamp()+(body.status==='ready'?cacheMs:pendingMs)).toISOString(),...(result?{result}:{})};
  const changed=await rows(db).updateMany({id:row.id,status:'running',operation_id:body.operation_id,plan_hash:row.plan_hash},{$set:patch});
  if(changed.updated!==1){const concurrent=await get(db,row.id);if(concurrent.report_hash!==reportHash)fail(409,'Price preview changed during reporting');}
  return {ok:true,status:body.status,preview_id:row.id};
 }
 return {enabled,request,poll,claim,report};
}


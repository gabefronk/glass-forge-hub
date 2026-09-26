const TEAM = '-O7aXXhvthc41u60Koc6';
const DB = 'https://probuild-prod.firebaseio.com/teams/' + TEAM;
const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const entries = v => v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).filter(([,x]) => x && typeof x === 'object') : [];
const sourceKey = (...parts) => ['probuild', TEAM, ...parts].join(':');
const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('');
const fail = (code, status = 400) => { throw Object.assign(Error(code), {safeCode:code,status}); };
const json = (value, status = 200) => Response.json(value, {status,headers:{'Cache-Control':'no-store'}});
const iso = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const date = v => iso(v) ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso(v))) : null;
const validId = v => typeof v === 'string' && ID.test(v) ? v : fail('invalid_identifier');
const publicRun = r => {
 const {current_plan, ...result} = r;
 return {...result, scope:'targeted_posts', history_complete:false};
};
async function all(entity, query) {
 const rows=[];
 for(let skip=0;skip<10000;skip+=500){const page=await entity.filter(query,'id',500,skip);rows.push(...page);if(page.length<500)return rows;}
 fail('record_limit',409);
}
function normalizeTargets(targets) {
 if(!Array.isArray(targets)||!targets.length||targets.length>10)fail('choose_one_to_ten_projects');
 const normalized=targets.map(t=>({project_id:validId(t.project_id),post_ids:[...new Set((Array.isArray(t.post_ids)?t.post_ids:[]).map(validId))].sort()})).sort((a,b)=>a.project_id.localeCompare(b.project_id));
 if(normalized.some(t=>!t.post_ids.length)||normalized.reduce((n,t)=>n+t.post_ids.length,0)>100||new Set(normalized.map(t=>t.project_id)).size!==normalized.length)fail('invalid_post_targets');
 return normalized;
}
export function createProbuildRefreshHandler({getClient,getToken,copyFile,fetchImpl=fetch,now=()=>new Date()}) {
 const busy = new Set();
 return async req => {
  if(req.method!=='POST')return json({error:'use_post'},405);
  let run, api, input, lock;
  try {
   const client=await getClient(req),user=await client.auth.me().catch(()=>null);
   if(user?.role!=='admin'||!OWNERS.has(String(user.email||'').toLowerCase().trim()))return json({error:'owner_access_required'},403);
   api=client.asServiceRole.entities;
   const raw=await req.text();if(raw.length>50000)fail('request_too_large',413);
   try{input=JSON.parse(raw);}catch{fail('invalid_json');}
   const at=now().toISOString();let tokenPromise;
   const token=()=>tokenPromise||=(getToken(client));
   const provider=async path=>{
    const response=await fetchImpl(DB+'/'+path+'.json?auth='+encodeURIComponent(await token()),{signal:AbortSignal.timeout(45000)});
    if(!response.ok)fail('source_http_'+response.status,502);
    const data=await response.json();if(data!==null&&(typeof data!=='object'||Array.isArray(data)))fail('invalid_source_payload',502);
    return data;
   };
   if(input.action==='probe_file'){
    const f=await api.FieldLibraryFile.get(validId(input.file_id));if(!f)fail('file_not_found',404);
    const p=await provider('projects/'+validId(f.source_project_id));if(!p)fail('source_project_unavailable',404);
    const post=await provider('posts/'+f.source_project_id+'/'+validId(f.source_post_id));
    const a=post?.attachments?.[validId(f.source_attachment_id)];if(!a)fail('source_attachment_unavailable',404);
    if(String(a.generation||'')!==String(f.generation||''))fail('source_generation_changed',409);
    const path=`teams/${TEAM}/posts/${f.source_project_id}/${f.source_post_id}/attachments/${f.source_attachment_id}`;
    const url='https://firebasestorage.googleapis.com/v0/b/probuild-prod.appspot.com/o/'+encodeURIComponent(path)+'?alt=media'+(f.generation?'&generation='+encodeURIComponent(f.generation):'');
    const response=await fetchImpl(url,{headers:{Authorization:'Firebase '+await token(),Range:'bytes=0-0'},signal:AbortSignal.timeout(45000)});
    const range=/^bytes 0-0\/(\d+)$/.exec(response.headers.get('content-range')||'');
    await response.body?.cancel();
    if(response.status!==206||!range)fail('source_range_not_verified',502);
    const total=Number(range[1]);
    return json({file_id:f.id,checked_at:at,source_generation:f.generation,source_bytes:total,declared_bytes:Number(a.fileMetadata?.sizeInBytes)||0,stored_bytes:f.size,stored_status:f.status,matches_stored:total===f.size,mime_type:response.headers.get('content-type')||null});
   }
   if(input.action==='start'){
    const targets=normalizeTargets(input.targets),requestKey=validId(input.request_key);
    const runKey=await sha(requestKey+':'+JSON.stringify(targets));
    const prior=(await api.ProbuildRefreshRun.filter({run_key:runKey},'-created_date',1))[0];if(prior)return json({run:publicRun(prior),resumed:true});
    // Fetch the owner's accessible project inventory. Client identifiers alone
    // never authorize a source read or create a new source project.
    const projects=await provider('projects');
    if(targets.some(t=>!projects?.[t.project_id]))fail('target_outside_accessible_projects',403);
    run=await api.ProbuildRefreshRun.create({run_key:runKey,scope:'targeted_posts',history_complete:false,targets,status:'metadata',phase:'metadata',cursor:0,attempts:0,next_retry_at:null,started_at:at,checked_at:at,completed_at:null,source_complete:false,writes_complete:false,assets_complete:false,file_ids:[],results:[],errors:[],issues:[],counts:{target_projects:targets.length,target_posts:targets.reduce((n,t)=>n+t.post_ids.length,0),declared_attachments:0,verified_assets:0},current_plan:null});
    return json({run:publicRun(run)});
   }
   if(input.action==='status'){
    run=input.run_id?await api.ProbuildRefreshRun.get(validId(input.run_id)):(await api.ProbuildRefreshRun.list('-created_date',1))[0];
    return json({run:run?publicRun(run):null});
   }
   if(input.action!=='next')fail('unsupported_action');
   run=await api.ProbuildRefreshRun.get(validId(input.run_id));if(!run)fail('run_not_found',404);
   if(run.status==='complete'||run.status==='failed')return json({run:publicRun(run)});
   if(input.cursor!==run.cursor||input.phase!==run.phase)return json({run:publicRun(run),stale_request:true});
   if(run.next_retry_at&&Date.parse(at)<Date.parse(run.next_retry_at))return json({run:publicRun(run),retry_after:run.next_retry_at},429);
   if(busy.has(run.id))return json({error:'run_busy',run:publicRun(run)},409);
   lock=run.id;busy.add(lock);
   const save=async patch=>{run=await api.ProbuildRefreshRun.update(run.id,{...patch,checked_at:at});return run;};
   if(run.phase==='metadata'){
    const target=run.targets[run.cursor];if(!target)fail('invalid_cursor',409);
    if(!run.current_plan){
     const p=await provider('projects/'+target.project_id);if(!p)fail('source_project_unavailable',502);
     const posts=await provider('posts/'+target.project_id);
     if(target.post_ids.some(pid=>!posts?.[pid]))fail('requested_post_absent_review_required',409);
     const oldProject=(await api.FieldLibraryProject.filter({source_key:sourceKey(target.project_id)},'id',2));
     if(oldProject.length>1)fail('duplicate_project_identity',409);
     const project=oldProject[0],priorReports=await all(api.FieldLibraryReport,{source_project_id:target.project_id}),priorFiles=await all(api.FieldLibraryFile,{source_project_id:target.project_id});
     if(new Set(priorReports.map(r=>r.source_key)).size!==priorReports.length||new Set(priorFiles.map(f=>f.source_key)).size!==priorFiles.length)fail('duplicate_library_identity',409);
     const revisions=[],reportRows=[],fileRows=[],issues=[];let created=0,edited=0,unchanged=0,deleted=0;
     const revision=async(key,snapshot)=>{if(snapshot)revisions.push({revision_key:await sha(key+':'+await sha(JSON.stringify(snapshot))),source_key:key,source_hash:await sha(JSON.stringify(snapshot)),source_snapshot:snapshot,observed_at:at,run_id:run.id});};
     await revision(sourceKey(target.project_id),project?.source_snapshot);await revision(sourceKey(target.project_id),p);
     for(const pid of target.post_ids){
      const post=posts[pid],key=sourceKey(target.project_id,pid),old=priorReports.find(r=>r.source_key===key),digest=await sha(JSON.stringify(post));
      if(!old)created++;else if(old.source_hash!==digest)edited++;else unchanged++;
      if(post.deletedAt)deleted++;
      await revision(key,old?.source_snapshot);await revision(key,post);
      const attachments=[];
      for(const [aid,a] of entries(post.attachments)){
       validId(aid);const generation=String(a.generation||''),fkey=sourceKey(target.project_id,pid,aid,generation),prior=priorFiles.find(f=>f.source_key===fkey);
       const name=a.fileMetadata?.name||a.documentName||`${aid}.${a.type==='photo'?'jpg':'bin'}`,mime=a.mimeType||(a.type==='photo'?'image/jpeg':'application/octet-stream');
       fileRows.push({source_key:fkey,source_project_id:target.project_id,source_post_id:pid,source_attachment_id:aid,generation,name,mime_type:prior?.status==='verified'?prior.mime_type:mime,source_type:a.type||'',source_snapshot:a,source_deleted:!!post.deletedAt||!!a.deletedAt,status:prior?.status==='verified'?'verified':prior?.status||'pending',source_size:Number(a.fileMetadata?.sizeInBytes)||0});
       attachments.push({id:aid,type:a.type||'',generation,name,mime_type:mime,source_key:fkey,size:Number(a.fileMetadata?.sizeInBytes)||0});
      }
      const keys=new Set(attachments.map(a=>a.source_key));
      const removed=priorFiles.filter(f=>f.source_post_id===pid&&!keys.has(f.source_key));
      if(removed.length)issues.push({code:'prior_attachment_not_in_current_post',project_id:target.project_id,post_id:pid,count:removed.length});
      reportRows.push({source_key:key,source_project_id:target.project_id,source_post_id:pid,project_name:p.name||p.title||target.project_id,report_date:date(post.createdAt),source_created_at:iso(post.createdAt),source_deleted:!!post.deletedAt,message:post.message||'',source_snapshot:post,source_hash:digest,source_checked_at:at,attachments});
     }
     if(fileRows.length>1000||JSON.stringify({revisions,reportRows,fileRows}).length>1500000)fail('target_payload_limit',409);
     const projectRow={source_key:sourceKey(target.project_id),source_project_id:target.project_id,name:p.name||p.title||target.project_id,description:p.description||'',archived:!!p.archivedAt,source_deleted:!!p.deletedAt,source_snapshot:p,source_hash:await sha(JSON.stringify(p)),source_checked_at:at,report_count:entries(posts).length,attachment_count:entries(posts).reduce((n,[,post])=>n+entries(post.attachments).length,0)};
     // Persist the intended writes and their original counts before mutating
     // library records, so a retry after a partial write retains the same plan.
     await save({current_plan:{projectRow,revisions,reportRows,fileRows,issues,counts:{created,edited,unchanged,deleted,declared_attachments:fileRows.length}},status:'metadata'});
    }
    const plan=run.current_plan;
    for(const revision of plan.revisions){if(!(await api.ProbuildSourceRevision.filter({revision_key:revision.revision_key},'id',1))[0])await api.ProbuildSourceRevision.create(revision);}
    const upsert=async(entity,row)=>{const found=await entity.filter({source_key:row.source_key},'id',2);if(found.length>1)fail('duplicate_library_identity',409);return found[0]?entity.update(found[0].id,row):entity.create(row);};
    const project=await upsert(api.FieldLibraryProject,plan.projectRow);
    for(const report of plan.reportRows)await upsert(api.FieldLibraryReport,{...report,library_project_id:project.id});
    const fileIds=[];for(const file of plan.fileRows){
     const latest=(await api.FieldLibraryFile.filter({source_key:file.source_key},'id',2));
     if(latest.length>1)fail('duplicate_library_identity',409);
     const row=latest[0]?.status==='verified'?{...file,status:'verified',mime_type:latest[0].mime_type}:file;
     fileIds.push((await upsert(api.FieldLibraryFile,row)).id);
    }
    const cursor=run.cursor+1,done=cursor===run.targets.length;
    const result={project_id:target.project_id,checked_at:at,source_complete:true,writes_complete:true,...plan.counts};
    await save({cursor:done?0:cursor,phase:done?'files':'metadata',status:done?'files':'metadata',source_complete:done,writes_complete:done,attempts:0,next_retry_at:null,current_plan:null,results:[...run.results,result],file_ids:[...new Set([...run.file_ids,...fileIds])],issues:[...run.issues,...plan.issues],counts:{...run.counts,declared_attachments:run.counts.declared_attachments+plan.counts.declared_attachments}});
   }else if(run.phase==='files'){
    const files=[];for(const fileId of run.file_ids)files.push(await api.FieldLibraryFile.get(fileId));
    const verified=files.filter(f=>f?.status==='verified'&&f.verified_at&&((f.file_uri&&f.sha256)||(f.chunks?.length&&f.manifest_sha256&&f.bytes_stored===f.size)));
    const pending=files.filter(f=>!verified.includes(f));
    if(pending.length){
     const f=pending[0];if(!f)fail('file_record_missing',409);
     const before=Number(f.bytes_stored)||0;
     const outcome=await copyFile(req,f.id);if(!outcome||outcome.error)fail('asset_copy_failed',502);
     const after=await api.FieldLibraryFile.get(f.id);
     if(after?.status!=='verified'&&(Number(after?.bytes_stored)||0)<=before)fail('asset_copy_no_progress',502);
     await save({status:'files',attempts:0,next_retry_at:null,counts:{...run.counts,verified_assets:verified.length},cursor:run.cursor+1});
    }else{
     await save({status:'complete',assets_complete:true,completed_at:at,attempts:0,next_retry_at:null,counts:{...run.counts,verified_assets:verified.length}});
    }
   }else fail('invalid_phase',409);
   return json({run:publicRun(run)});
  } catch(error) {
   const code=error.safeCode||'refresh_step_failed';
   // Optional sanitized cause (e.g. why an asset copy failed); set only by callers that scrub it.
   const detail=error.safeCode&&error.safeDetail?{detail:String(error.safeDetail).slice(0,300)}:{};
   // Authentication, validation and pre-run failures never fabricate a run.
   if(run&&api&&input?.action==='next'&&!['complete','failed'].includes(run.status)){
    const attempts=(run.attempts||0)+1,failed=attempts>=3;
    const at=now().toISOString();
    try{run=await api.ProbuildRefreshRun.update(run.id,{status:failed?'failed':'retry_wait',attempts,next_retry_at:failed?null:new Date(Date.parse(at)+[30000,120000][attempts-1]).toISOString(),checked_at:at,errors:[...(run.errors||[]),{code,...detail,at,phase:run.phase,cursor:run.cursor,attempt:attempts}]});}catch{return json({error:'run_receipt_write_failed',run_id:run.id},503);}
    return json({error:code,run:publicRun(run)},error.status||502);
   }
   return json({error:code},error.status||502);
  } finally {if(lock)busy.delete(lock);}
 };
}
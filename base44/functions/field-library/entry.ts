import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {getProbuildIdToken} from '../../shared/probuildApi.ts';
const TEAM='-O7aXXhvthc41u60Koc6';
const DB='https://probuild-prod.firebaseio.com/teams/'+TEAM;
const OWNERS=new Set(['gabefronk@gmail.com','gabriel.fronk.wd@gmail.com']);
const ID=/^[A-Za-z0-9_-]{1,160}$/;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{publicMessage:message,status});};
const id=v=>ID.test(v||'')?v:fail('Invalid identifier.');
const entries=v=>Object.entries(v||{}).filter(([,x])=>x&&typeof x==='object');
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const hashBytes=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hashBytes(new TextEncoder().encode(value));
const sourceKey=(...parts)=>['probuild',TEAM,...parts].join(':');
const iso=v=>typeof v==='number'?new Date(v).toISOString():String(v||'');
const date=value=>{const v=iso(value);return Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)):'';};
const escapeRegex=s=>String(s||'').slice(0,150).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function all(entity,query={}){const rows=[];for(let offset=0;;offset+=500){const batch=await entity.filter(query,'id',500,offset);rows.push(...batch);if(batch.length<500)return rows;}}
async function parallel(items,fn,n=5){let next=0;const out=new Array(items.length);await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}));return out;}
async function boundedBytes(response,max=104857600){
 if(Number(response.headers.get('content-length'))>max)fail('File exceeds the 100 MB transfer limit.',413);
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail('File exceeds the 100 MB transfer limit.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}return bytes;
}
async function mergeRows(entity,existing,rows){
 const byKey=new Map(existing.map(r=>[r.source_key,r])),missing=rows.filter(r=>!byKey.has(r.source_key));
 for(let i=0;i<missing.length;i+=50){const batch=missing.slice(i,i+50);if(entity.bulkCreate)await entity.bulkCreate(batch);else for(const row of batch)await entity.create(row);}
 await parallel(rows.filter(r=>byKey.has(r.source_key)),r=>entity.update(byKey.get(r.source_key).id,r));
}
const displayName=f=>{const ext={'image/jpeg':'jpg','image/png':'png','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/quicktime':'mov','application/pdf':'pdf'}[f.mime_type];return ext&&!f.source_snapshot?.fileMetadata?.name&&f.name?.endsWith('.bin')?f.name.slice(0,-3)+ext:f.name;};
const publicFile=({file_uri,source_snapshot,chunks,...f})=>({...f,name:displayName({...f,source_snapshot}),chunks:(chunks||[]).map(({file_uri,...c})=>c)});
function reportView(r,files=[]){const byKey=new Map(files.map(f=>[f.source_key,f]));return {id:r.id,source:'library',project_id:r.source_project_id,project_name:r.project_name,post_id:r.source_post_id,created_at:r.source_created_at,date:r.report_date,message:r.message,deleted:r.source_deleted,attachments:(r.attachments||[]).map(a=>{const f=byKey.get(a.source_key);return f?{...a,type:f.mime_type?.startsWith('image/')?'photo':a.type||'file',mime_type:f.mime_type||a.mime_type,name:displayName(f)||a.name,size:f.size||a.size,status:f.status}:a;}),source_checked_at:r.source_checked_at};}
function createFieldLibraryHandler({getClient,getToken,fetchImpl=fetch,now=()=>new Date()}){
 const sourceTokenCache={value:null,until:0},importCache=new Map();
 return async req=>{
  if(req.method!=='POST')return json({error:'Use POST.'},405);
  let stage='authorization';
  try{
   const client=await getClient(req),api=client.asServiceRole.entities,key=req.headers.get('x-glass-forge-control-key');
   if(key){if(key.length<40||key.length>200)fail('Device authorization required.',401);if(!(await api.ProbuildControlDevice.filter({token_hash:await hash(key),enabled:true},'-created_date',1))[0])fail('Device authorization required.',401);}
   else{const u=await client.auth.me().catch(()=>null);if(u?.role!=='admin'||!OWNERS.has(String(u.email||'').toLowerCase().trim()))fail('Owner access required.',403);}
   const raw=await req.text();if(raw.length>1048576)fail('Request too large.',413);let input;try{input=JSON.parse(raw);}catch{fail('Invalid JSON.');}
   const {action}=input,at=now().toISOString();let tokenPromise;
   const token=()=>tokenPromise||=(sourceTokenCache.value&&Date.now()<sourceTokenCache.until?Promise.resolve(sourceTokenCache.value):getToken(client).then(value=>{sourceTokenCache.value=value;sourceTokenCache.until=Date.now()+45*60000;return value;}));
   const provider=async path=>{const r=await fetchImpl(DB+'/'+path+'.json?auth='+encodeURIComponent(await token()),{signal:AbortSignal.timeout(45000)});if(!r.ok)fail('ProBuild source read failed (HTTP '+r.status+').',502);return r.json();};
   const signed=async uri=>(await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:uri,expires_in:900})).signed_url;
   const runFor=async()=>{const rid=id(input.run_id),cached=importCache.get(rid);if(cached&&Date.now()<cached.until)return cached.run;const run=await api.FieldLibraryImport.get(rid);if(!run)fail('Import not found.',404);importCache.set(rid,{run,until:Date.now()+10*60000});return run;};
   if(action==='start_import'){
    const active=(await api.FieldLibraryImport.filter({phase:{$in:['metadata','files']}},'-created_date',1))[0];
    if(active)return json({run:active,resumed:true});
    const snapshot=await provider('projects'),ids=entries(snapshot).map(([pid])=>pid);
    const run=await api.FieldLibraryImport.create({phase:'metadata',started_at:at,checked_at:at,source_snapshot:snapshot,project_ids:ids,projects_checked:0,reports_imported:0,files_discovered:0,files_verified:0,bytes_verified:0,errors:[],source_complete:false,files_complete:false});
    return json({run});
   }
   if(action==='import_project'){
    stage='load-import';const run=await runFor(),pid=id(input.project_id);if(!run.project_ids.includes(pid))fail('Project is outside this import.');
    stage='load-posts';const p=run.source_snapshot[pid],posts=await provider('posts/'+pid),pkey=sourceKey(pid);
    stage='job-link';const link=(await api.ProbuildProjectLink.filter({project_id:pid},'-updated_date',1))[0];
    stage='project-lookup';const old=(await api.FieldLibraryProject.filter({source_key:pkey},'-created_date',1))[0];
    stage='project-build';const row={source_key:pkey,source_project_id:pid,name:p.name||p.title||pid,description:p.description||'',archived:!!p.archivedAt,source_deleted:!!p.deletedAt,job_id:link?.job_id||'',job_name:link?.job_name||'',source_snapshot:p,source_hash:await hash(JSON.stringify(p)),source_checked_at:at,report_count:entries(posts).length,attachment_count:entries(posts).reduce((n,[,post])=>n+entries(post.attachments).length,0),import_run_id:run.id};
    stage='project-save';const project=old?await api.FieldLibraryProject.update(old.id,row):await api.FieldLibraryProject.create(row);
    stage='existing-records';const [existingReports,existingFiles]=await Promise.all([all(api.FieldLibraryReport,{source_project_id:pid}),all(api.FieldLibraryFile,{source_project_id:pid})]);
    const fileMap=new Map(existingFiles.map(f=>[f.source_key,f]));const reports=[],files=[];
    for(const [postId,post] of entries(posts)){
     const attachments=[];
     for(const [attachmentId,a] of entries(post.attachments)){
      const generation=String(a.generation||''),fkey=sourceKey(pid,postId,attachmentId,generation),prior=fileMap.get(fkey);
      const name=a.fileMetadata?.name||a.documentName||`${attachmentId}.${a.type==='photo'?'jpg':'bin'}`;
      const mime=a.mimeType||(a.type==='photo'?'image/jpeg':'application/octet-stream');
      const f={source_key:fkey,source_project_id:pid,source_post_id:postId,source_attachment_id:attachmentId,generation,name,mime_type:mime,source_type:a.type||'',source_snapshot:a,source_deleted:!!post.deletedAt||!!a.deletedAt,status:prior?.status==='verified'?'verified':'pending',source_size:Number(a.fileMetadata?.sizeInBytes)||0,import_run_id:run.id};
      files.push(f);attachments.push({id:attachmentId,type:a.type||'',generation,name,mime_type:mime,source_key:fkey,size:f.source_size});
     }
     reports.push({source_key:sourceKey(pid,postId),source_project_id:pid,source_post_id:postId,library_project_id:project.id,project_name:row.name,report_date:date(post.createdAt),source_created_at:iso(post.createdAt),source_deleted:!!post.deletedAt,message:post.message||'',source_snapshot:post,source_hash:await hash(JSON.stringify(post)),source_checked_at:at,attachments,import_run_id:run.id});
    }
    stage='save-reports';await mergeRows(api.FieldLibraryReport,existingReports,reports);stage='save-files';await mergeRows(api.FieldLibraryFile,existingFiles,files);
    return json({project_id:pid,library_project_id:project.id,reports:reports.length,files:files.length,source_deleted:row.source_deleted,archived:row.archived});
   }
   if(action==='pending_files'){
    const run=await runFor();return json({files:(await api.FieldLibraryFile.filter({import_run_id:run.id,status:{$ne:'verified'}},'id',Math.min(500,Number(input.limit)||100),Math.max(0,Number(input.offset)||0))).map(publicFile)});
   }
   const copyFile=async fileId=>{
    stage='load-file';const f=await api.FieldLibraryFile.get(id(fileId));if(!f)fail('File not found.',404);
    if(f.status==='verified')return {file:publicFile(f),already_verified:true};
    try{
     const path=`teams/${TEAM}/posts/${id(f.source_project_id)}/${id(f.source_post_id)}/attachments/${id(f.source_attachment_id)}`;
     const url='https://firebasestorage.googleapis.com/v0/b/probuild-prod.appspot.com/o/'+encodeURIComponent(path)+'?alt=media'+(f.generation?'&generation='+encodeURIComponent(f.generation):'');
     const chunkSize=6*1048576,offset=Number(f.bytes_stored)||0;
     stage='read-original-file';const response=await fetchImpl(url,{headers:{Authorization:'Firebase '+await token(),Range:`bytes=${offset}-${offset+chunkSize-1}`},signal:AbortSignal.timeout(90000)});
     if(!response.ok)fail('Original attachment unavailable (HTTP '+response.status+').',502);
     const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
     if(response.status===206&&(!range||Number(range[1])!==offset))fail('Source returned an invalid file range.',502);
     if(offset&&!range)fail('Source did not honor the requested file range.',502);
     const bytes=await boundedBytes(response,chunkSize),mime=response.headers.get('content-type')||f.mime_type,total=range?Number(range[3]):bytes.length;
     if(range&&Number(range[2])-Number(range[1])+1!==bytes.length)fail('Source file range is incomplete.',502);
     if(f.size&&f.chunks?.length&&f.size!==total)fail('Source file size changed during transfer.',409);
     if(!bytes.length||/text\/html|application\/json/.test(mime))fail('Invalid source attachment.',502);
     const digest=await hashBytes(bytes);
     const multipart=total>chunkSize;
     stage='upload-private-file';const uploaded=await client.asServiceRole.integrations.Core.UploadPrivateFile({file:new File([bytes],multipart?f.name+'.part-'+offset+'.bin':f.name,{type:multipart?'application/octet-stream':mime})});
     if(!uploaded.file_uri)fail('Glass Forge did not store the file.',502);
     stage='verify-private-file';const copied=await fetchImpl(await signed(uploaded.file_uri),{signal:AbortSignal.timeout(90000)});
     if(!copied.ok)fail('Stored file could not be verified.',502);
     const checked=await boundedBytes(copied,chunkSize);if(checked.length!==bytes.length||await hashBytes(checked)!==digest)fail('Stored file does not match its source.',502);
     const latest=await api.FieldLibraryFile.get(f.id);if((latest.bytes_stored||0)!==offset)return {file:publicFile(latest),partial:latest.status!=='verified'};
     const chunks=[...(f.chunks||[]),{offset,size:bytes.length,sha256:digest,file_uri:uploaded.file_uri}],stored=offset+bytes.length,complete=stored===total;
     if(stored>total)fail('Stored file exceeds the source size.',502);
     const manifest=chunks.map(({offset,size,sha256})=>({offset,size,sha256}));
     stage='save-file-receipt';const saved=await api.FieldLibraryFile.update(f.id,{status:complete?'verified':'copying',file_uri:multipart?'':uploaded.file_uri,chunks,bytes_stored:stored,size:total,mime_type:mime,sha256:multipart?'':digest,manifest_sha256:await hash(JSON.stringify(manifest)),verified_at:complete?at:'',error:'',attempts:(f.attempts||0)+1});
     return {file:publicFile(saved),partial:!complete};
    }catch(e){await api.FieldLibraryFile.update(f.id,{status:'error',error:e.publicMessage||'File transfer interrupted.',attempts:(f.attempts||0)+1});throw e;}
   };
   if(action==='copy_file')return json(await copyFile(input.file_id));
   if(action==='copy_files'){
    const ids=input.file_ids;if(!Array.isArray(ids)||!ids.length||ids.length>8||new Set(ids).size!==ids.length)fail('Choose one to eight distinct files.');ids.forEach(id);
    const results=await parallel(ids,async fileId=>{try{return {file_id:fileId,...await copyFile(fileId)};}catch(e){return {file_id:fileId,error:e.publicMessage||'File transfer interrupted. Retry this file.',status:e.status||e.response?.status||500};}},2);
    return json({results});
   }
   if(action==='audit_import'){
    stage='audit-import';
    const run=await runFor();const [projects,reports,files]=await Promise.all([all(api.FieldLibraryProject,{import_run_id:run.id}),all(api.FieldLibraryReport,{import_run_id:run.id}),all(api.FieldLibraryFile,{import_run_id:run.id})]);
    const imported=new Set(projects.map(p=>p.source_project_id)),missingProjects=run.project_ids.filter(pid=>!imported.has(pid));
    const missingReports=projects.filter(p=>reports.filter(r=>r.source_project_id===p.source_project_id).length!==p.report_count).map(p=>p.source_project_id);
    const missingFileRecords=projects.filter(p=>files.filter(f=>f.source_project_id===p.source_project_id).length<p.attachment_count).map(p=>p.source_project_id);
    const pending=files.filter(f=>f.status!=='verified'),sourceComplete=!missingProjects.length&&!missingReports.length&&!missingFileRecords.length;
    const complete=sourceComplete&&!pending.length,phase=complete?'complete':sourceComplete?'files':'metadata';
    const audit={missing_projects:missingProjects,report_count_mismatches:missingReports,file_record_mismatches:missingFileRecords,unverified_files:pending.length,failed_files:pending.filter(f=>f.status==='error').length,deleted_projects:projects.filter(p=>p.source_deleted).length,archived_projects:projects.filter(p=>p.archived).length,deleted_reports:reports.filter(p=>p.source_deleted).length,source_attachment_count:projects.reduce((n,p)=>n+p.attachment_count,0)};
    const saved=await api.FieldLibraryImport.update(run.id,{phase,checked_at:at,projects_checked:projects.length,reports_imported:reports.length,files_discovered:files.length,files_verified:files.length-pending.length,bytes_verified:files.reduce((n,f)=>n+(f.status==='verified'?f.size||0:0),0),source_complete:sourceComplete,files_complete:complete,audit});
    const {source_snapshot,project_ids,...view}=saved;return json({run:view});
   }
   if(action==='status'){
    const run=(await api.FieldLibraryImport.list('-created_date',1))[0];if(!run)return json({run:null});const {source_snapshot,project_ids,...view}=run;return json({run:view});
   }
   if(action==='projects'){
    const term=escapeRegex(input.search),query={...(input.include_deleted?{}:{source_deleted:false}),...(term?{name:{$regex:term,$options:'i'}}:{})};
    const rows=await api.FieldLibraryProject.filter(query,'name',51,Math.max(0,Number(input.offset)||0));
    return json({projects:rows.slice(0,50).map(({source_snapshot,...p})=>p),has_more:rows.length>50});
   }
   if(action==='project'){
    const p=await api.FieldLibraryProject.get(id(input.project_id));if(!p)fail('Project not found.',404);
    const [rows,files]=await Promise.all([api.FieldLibraryReport.filter({library_project_id:p.id,...(input.include_deleted?{}:{source_deleted:false})},'-source_created_at',51,Math.max(0,Number(input.offset)||0)),all(api.FieldLibraryFile,{source_project_id:p.source_project_id})]);
    const {source_snapshot,...project}=p;return json({project,reports:rows.slice(0,50).map(r=>reportView(r,files)),has_more:rows.length>50});
   }
   if(action==='file'){
    const f=(await api.FieldLibraryFile.filter({source_key:String(input.source_key||'').slice(0,800)},'-created_date',1))[0];
    if(!f||f.status!=='verified'||(!f.file_uri&&!f.chunks?.length))fail('This attachment has not finished transferring.',409);
    const chunks=f.file_uri?[]:await parallel(f.chunks,async c=>({url:await signed(c.file_uri),offset:c.offset,size:c.size,sha256:c.sha256}),3);
    return json({file:publicFile(f),url:f.file_uri?await signed(f.file_uri):null,chunks,name:displayName(f),mime_type:f.mime_type,size:f.size,sha256:f.sha256,manifest_sha256:f.manifest_sha256});
   }
   if(action==='report'){
    const r=await api.FieldLibraryReport.get(id(input.report_id));if(!r)fail('Report not found.',404);const files=await all(api.FieldLibraryFile,{source_project_id:r.source_project_id,source_post_id:r.source_post_id});return json({report:reportView(r,files)});
   }
   fail('Unsupported action.');
  }catch(error){if(error.publicMessage)return json({error:error.publicMessage},error.status||400);console.error('Field library failed',error?.name||'Error');return json({error:'The library request could not finish at '+stage+'. '+String(error?.response?.status||error?.status||'')+' '+(Number(error?.response?.status||error?.status)===429?'The service is busy; retry shortly.':'Retrying preserves imported records.')},500);}
 };
}

Deno.serve(createFieldLibraryHandler({getClient:createClientFromRequest,getToken:getProbuildIdToken}));

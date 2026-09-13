import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {getProbuildIdToken} from '../../shared/probuildApi.ts';
// Inlined handler; mirrored by the tested shared sources.
// Private attachment bytes stay behind the authenticated owner endpoint.
export async function readPrivateMessageAttachment(client, attachment, fetchFile = fetch) {
 const max = 8388608;
 const {signed_url} = await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:attachment.file_uri,expires_in:60});
 if(!signed_url)throw Error('Private attachment unavailable.');
 const r = await fetchFile(signed_url,{signal:AbortSignal.timeout(45000),cache:'no-store'});
 if(!r.ok || Number(r.headers.get('content-length'))>max)throw Error('Private attachment unavailable.');
 const reader=r.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Private attachment exceeds transfer limit.');}parts.push(value);}}
 finally{reader.releaseLock();}
 if(!size)throw Error('Private attachment is empty.');
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 return {base64:btoa(binary),size,sha256,name:attachment.name||'attachment',mime_type:attachment.mime_type||'application/octet-stream'};
}

// Owner-controlled ProBuild reports. Provider content is data, never instructions.
export const TEAM = '-O7aXXhvthc41u60Koc6';
const DB = 'https://probuild-prod.firebaseio.com/teams/' + TEAM;
const BUCKET = 'https://firebasestorage.googleapis.com/v0/b/probuild-prod.appspot.com/o/';
const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const clean = (v, n = 300) => typeof v === 'string' ? v.slice(0, n) : '';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status, publicMessage: message}); };
const validId = v => ID.test(v || '') ? v : fail('Invalid source identifier.');
export const hash = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');
const json = (v, status = 200) => Response.json(v, {status, headers: {'Cache-Control':'no-store'}});
export const mountainDate = v => Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat('en-CA', {timeZone:'America/Denver', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(v)) : '';
const entries = v => Object.entries(v || {}).filter(([,x]) => x && typeof x === 'object');
const asBase64 = bytes => {let s=''; for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768)); return btoa(s);};
const projectPublic = p => ({id:p.id,name:clean(p.name||p.title,1000),description:clean(p.description,20000),status:clean(p.status),archived:!!p.archivedAt,deleted:!!p.deletedAt,last_modified_at:p.lastModifiedAt||null});
export function normalizePost(project, postId, p) {
 return {source:'probuild',project_id:project.id,project_name:project.name||project.title||'',post_id:postId,created_at:p.createdAt||'',date:mountainDate(p.createdAt),message:clean(p.message,100000),deleted:!!p.deletedAt,
  attachments:entries(p.attachments).map(([id,a])=>({id,type:clean(a.type),generation:clean(String(a.generation||'')),name:clean(a.fileMetadata?.name)||`${id}.${a.type==='photo'?'jpg':'bin'}`,mime_type:clean(a.mimeType)|| (a.type==='photo'?'image/jpeg':'application/octet-stream'),size:Number(a.fileMetadata?.sizeInBytes)||0,width:a.imageMetadata?.width||0,height:a.imageMetadata?.height||0,document_name:clean(a.documentName)}))};
}
export function validateRange(start,end) {
 const valid = d => /^\d{4}-\d{2}-\d{2}$/.test(d||'') && Number.isFinite(Date.parse(d+'T12:00:00Z')) && new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 if(!valid(start)||!valid(end)||end<start||Date.parse(end)-Date.parse(start)>31*86400000)fail('Choose a valid date range of up to 31 days.');
 return {start,end};
}
export async function boundedBytes(response, max=25165824) {
 if(Number(response.headers.get('content-length'))>max)fail('This file is too large for one transfer.',413);
 const reader=response.body.getReader(),chunks=[];let size=0;
 try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail('This file is too large for one transfer.',413);}chunks.push(value);}}
 finally {reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
export function createProbuildControlHandler({getClient,getToken,fetchImpl=fetch,now=()=>new Date()}) {
 return async req => {
  if(req.method!=='POST')return json({error:'Use POST.'},405);
  try {
   const client=await getClient(req),api=client.asServiceRole.entities;
   const key=req.headers.get('x-glass-forge-control-key');
   if(key){
    if(key.length<40||key.length>200)fail('Device authorization required.',401);
    const device=(await api.ProbuildControlDevice.filter({token_hash:await hash(key),enabled:true},'-created_date',1))[0];
    if(!device)fail('Device authorization required.',401);
   }else{
    const u=await client.auth.me().catch(()=>null);
    if(u?.role!=='admin'||!OWNERS.has(String(u.email||'').trim().toLowerCase()))fail('Owner access required.',403);
   }
   const raw=await req.text();if(raw.length>35000000)fail('Request too large.',413);
   let input;try{input=JSON.parse(raw);}catch{fail('Invalid JSON.');}
   const action=input.action,at=now().toISOString();
   // General report automation keys never authorize access to Gabriel's texts.
   if(key && (['message_sources','message_photo'].includes(action) || (action==='save_report' && input.message_ids?.length)))fail('Sign in with Gabriel’s owner account to access private messages.',403);
   let tokenPromise;
   const auth=()=>tokenPromise ||= getToken(client);
   const provider=async(path,options={})=>{
    const response=await fetchImpl(DB+'/'+path+'.json?auth='+encodeURIComponent(await auth()),{signal:AbortSignal.timeout(45000),...options});
    if(response.status===412)fail('This project changed. Refresh it before saving.',409);
    if(!response.ok)fail('ProBuild could not complete this request. Your existing data is unchanged.',502);
    return response;
   };
   const allProjects=async()=>entries(await (await provider('projects')).json()).map(([id,p])=>({id,...p}));
   const oneProject=async(id)=>{
    validId(id);const p=await (await provider('projects/'+id)).json();
    if(!p||p.deletedAt)fail('Project unavailable.',404);return {id,...p};
   };
   const postList=async p=>entries(await (await provider('posts/'+validId(p.id))).json()).map(([id,x])=>normalizePost(p,id,x)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
   const links=async(query={})=>api.ProbuildProjectLink.filter(query,'-updated_date',1000);
   const signed=async file_uri=>(await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri,expires_in:900})).signed_url;
   const publicDraft=d=>({...d,files:(d.files||[]).map(({file_uri,...a})=>a)});
   if(action==='jobs'){
    const term=clean(input.search,120).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return json({jobs:(await api.Jobs.filter(term?{canonical_name:{$regex:term,$options:'i'}}:{},'canonical_name',60)).map(j=>({id:j.id,name:j.canonical_name,address:j.address}))});
   }
   if(action==='reports')return json({reports:(await api.ProbuildReportDraft.filter(input.job_id?{job_id:clean(input.job_id)}:{},'-updated_date',50)).filter(d=>!key||!d.messages?.length).map(d=>({id:d.id,title:d.title,report_date:d.report_date,job_id:d.job_id,job_name:d.job_name,updated_date:d.updated_date,post_count:d.posts?.length||0}))});
   if(action==='report'){
    const d=await api.ProbuildReportDraft.get(validId(input.report_id));if(!d)fail('Report not found.',404);if(key&&d.messages?.length)fail('Sign in with Gabriel’s owner account to access this private report.',403);return json({report:publicDraft(d)});
   }
   if(action==='projects'){
    const [projects,linked]=await Promise.all([allProjects(),links()]);
    return json({projects:projects.filter(p=>!p.deletedAt).map(p=>({...projectPublic(p),job:linked.find(l=>l.project_id===p.id)||null})),checked_at:at});
   }
   if(action==='project'){
    const p=await oneProject(input.project_id);const [posts,linked]=await Promise.all([postList(p),links({project_id:p.id})]);
    return json({project:{...projectPublic(p),version:await hash(JSON.stringify([p.name||'',p.description||'']))},posts:posts.filter(p=>!p.deleted),job:linked[0]||null,checked_at:at});
   }
   const scanView=scan=>({scan_id:scan.id,next_offset:scan.cursor,finished:scan.finished===true&&!(scan.errors||[]).length,posts:scan.posts||[],coverage:{complete:scan.finished===true&&!(scan.errors||[]).length,accessible_projects:scan.projects.length,checked_projects:scan.cursor,failed_projects:scan.errors||[],start_date:scan.start_date,end_date:scan.end_date,checked_at:scan.checked_at||scan.started_at,started_at:scan.started_at,source:'Authenticated ProBuild project reads',attachment_count:(scan.posts||[]).reduce((n,p)=>n+p.attachments.length,0)}});
   if(action==='daily'){
    const {start,end}=validateRange(input.start_date,input.end_date||input.start_date),projects=(await allProjects()).filter(p=>!p.deletedAt).map(p=>({id:p.id,name:p.name||p.title||''}));
    const scan=await api.ProbuildReportScan.create({start_date:start,end_date:end,projects,cursor:0,posts:[],errors:[],started_at:at,finished:projects.length===0,checked_at:at});
    return json(scanView(scan));
   }
   if(action==='daily_next'   if(action==='daily_next'){
    const scan=await api.ProbuildReportScan.get(validId(input.scan_id));if(!scan)fail('Source scan not found.',404);
    if(input.offset!==scan.cursor)return json(scanView(scan));
    const legacyRetry=scan.cursor===scan.projects.length&&(scan.errors||[]).length>0;
    if(scan.finished&&!legacyRetry)return json(scanView(scan));
    const retry=scan.retry_state||{};
    if(retry.exhausted)return json({...scanView(scan),error:'Source page retry limit reached; review is required.'},409);
    if(retry.next_retry_at&&Date.parse(at)<Date.parse(retry.next_retry_at))return json({...scanView(scan),retry_after:retry.next_retry_at},429);
    const failedIds=new Set((scan.errors||[]).map(e=>e.project_id));
    const batch=legacyRetry?scan.projects.filter(p=>failedIds.has(p.id)).slice(0,30):scan.projects.slice(scan.cursor,scan.cursor+30);
    if(!batch.length)return json({...scanView(scan),error:'Source scan coverage requires review.'},409);
    const results=new Array(batch.length);let next=0;
    const worker=async()=>{for(;;){const i=next++;if(i>=batch.length)return;const p=batch[i];try{const list=await postList(p);results[i]={posts:list.filter(x=>!x.deleted&&x.date>=scan.start_date&&x.date<=scan.end_date)};}catch{results[i]={error:{project_id:p.id,project_name:p.name}};}}};
    await Promise.all(Array.from({length:Math.min(6,batch.length)},worker));
    const latest=await api.ProbuildReportScan.get(scan.id);
    if(latest.cursor!==scan.cursor||JSON.stringify(latest.retry_state||{})!==JSON.stringify(scan.retry_state||{}))return json(scanView(latest));
    const failures=results.filter(r=>r.error).map(r=>r.error);
    if(failures.length){
     const attempts=(retry.cursor===scan.cursor?Number(retry.attempts)||0:0)+1,exhausted=attempts>=3;
     const pageIds=new Set(batch.map(p=>p.id));
     const errors=[...(scan.errors||[]).filter(e=>!pageIds.has(e.project_id)),...failures];
     const history=[...(scan.error_history||[]),{action:'daily_next',code:'source_page_incomplete',at,cursor:scan.cursor,attempt:attempts,failed_project_ids:failures.map(e=>e.project_id)}].slice(-100);
     const saved=await api.ProbuildReportScan.update(scan.id,{errors,error_history:history,retry_state:{cursor:scan.cursor,attempts,exhausted,next_retry_at:exhausted?null:new Date(Date.parse(at)+(attempts===1?30000:120000)).toISOString()},checked_at:at});
     return json({...scanView(saved),error:exhausted?'Source page retry limit reached; review is required.':'Source page incomplete; saved cursor retained.'},exhausted?409:502);
    }
    const pageIds=new Set(batch.map(p=>p.id)),errors=(scan.errors||[]).filter(e=>!pageIds.has(e.project_id));
    const byId=new Map((scan.posts||[]).map(p=>[p.project_id+':'+p.post_id,p]));
    for(const post of results.flatMap(r=>r.posts||[]))byId.set(post.project_id+':'+post.post_id,post);
    const cursor=legacyRetry?scan.cursor:scan.cursor+batch.length;
    const saved=await api.ProbuildReportScan.update(scan.id,{cursor,posts:[...byId.values()],errors,finished:cursor===scan.projects.length&&!errors.length,retry_state:{cursor,attempts:0,exhausted:false,next_retry_at:null},checked_at:at});
    return json(scanView(saved));
   }

    const p=await oneProject(input.project_id),job=input.job_id?await api.Jobs.get(validId(input.job_id)):null;
    if(input.job_id&&!job)fail('Choose an existing job.');
    const prior=(await links({project_id:p.id}))[0],row={project_id:p.id,project_name:p.name,job_id:job?.id||'',job_name:job?.canonical_name||''};
    const saved=prior?await api.ProbuildProjectLink.update(prior.id,row):await api.ProbuildProjectLink.create(row);
    return json({job:saved});
   }
   if(action==='edit_project'){
    const id=validId(input.project_id),response=await provider('projects/'+id,{headers:{'X-Firebase-ETag':'true'}}),p=await response.json();
    if(!p||p.deletedAt)fail('Project unavailable.',404);
    const version=await hash(JSON.stringify([p.name||'',p.description||'']));
    if(input.expected_version!==version)fail('Project details changed. Refresh before saving.',409);
    const patch=input.patch||{};
    if(Object.keys(patch).some(k=>!['name','description'].includes(k)))fail('Only project name and description can be edited here.');
    if('name' in patch&&(typeof patch.name!=='string'||!patch.name.trim()||patch.name.length>1000))fail('Enter a project name.');
    if('description' in patch&&(typeof patch.description!=='string'||patch.description.length>20000))fail('Description is too long.');
    const updated={...p,...patch,lastModifiedAt:at};
    if(input.apply!==true)return json({preview:true,project_id:id,before:{name:p.name||'',description:p.description||''},after:{name:updated.name,description:updated.description||''},expected_version:version});
    const etag=response.headers.get('etag');if(!etag)fail('ProBuild did not provide a version check. No change was saved.',502);
    await provider('projects/'+id,{method:'PUT',headers:{'Content-Type':'application/json','if-match':etag},body:JSON.stringify(updated)});
    return json({saved:true,project:{...projectPublic({id,...updated}),version:await hash(JSON.stringify([updated.name||'',updated.description||'']))}});
   }
   if(action==='photo'||action==='photo_bytes'){
    const p=await oneProject(input.project_id),postId=validId(input.post_id),attachmentId=validId(input.attachment_id);
    const post=await (await provider('posts/'+p.id+'/'+postId)).json();
    const attachment=post?.attachments?.[attachmentId];
    if(!attachment||post.deletedAt||!['photo','file'].includes(attachment.type))fail('Original attachment unavailable.',404);
    const generation=String(attachment.generation||'');
    if(input.generation&&input.generation!==generation)fail('This attachment changed in ProBuild. Refresh the report source.',409);
    const assetKey=await hash([p.id,postId,attachmentId,generation].join(':'));
    const cached=(await api.ProbuildAsset.filter({asset_key:assetKey},'-created_date',1))[0];
    if(cached&&action==='photo')return json({asset_id:cached.id,url:await signed(cached.file_uri),name:cached.name,mime_type:cached.mime_type,size:cached.size,sha256:cached.sha256});
    // This path is the official web client's FileReference.PostAttachments layout.
    const path=`teams/${TEAM}/posts/${p.id}/${postId}/attachments/${attachmentId}`;
    const url=BUCKET+encodeURIComponent(path)+'?alt=media'+(generation?'&generation='+encodeURIComponent(generation):'');
    const response=await fetchImpl(url,{headers:{Authorization:'Firebase '+await auth()},signal:AbortSignal.timeout(45000)});
    if(!response.ok)fail('The original photo could not be downloaded from ProBuild.',502);
    const bytes=await boundedBytes(response),mime=clean(response.headers.get('content-type'),100)||attachment.mimeType||'application/octet-stream';
    if(!bytes.length||/text\/html|application\/json/.test(mime))fail('ProBuild returned an invalid attachment.',502);
    const name=clean(attachment.fileMetadata?.name)||`${attachmentId}.${mime.includes('png')?'png':mime.startsWith('image/')?'jpg':'bin'}`;
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(action==='photo_bytes')return json({name,mime_type:mime,size:bytes.length,sha256,base64:asBase64(bytes)});
    const {file_uri}=await client.asServiceRole.integrations.Core.UploadPrivateFile({file:new File([bytes],name,{type:mime})});
    if(!file_uri)fail('Could not save the private photo copy.',502);
    const asset=await api.ProbuildAsset.create({asset_key:assetKey,project_id:p.id,post_id:postId,attachment_id:attachmentId,generation,name,mime_type:mime,size:bytes.length,sha256,file_uri});
    return json({asset_id:asset.id,url:await signed(file_uri),name,mime_type:mime,size:bytes.length,sha256});
   }
   if(action==='message_sources'){
    let conversations=[];
    if(input.conversation_key)conversations=await api.MessageConversation.filter({conversation_key:clean(input.conversation_key)},'-last_message_at',1);
    else if(input.job_id)conversations=await api.MessageConversation.filter({job_id:validId(input.job_id)},'-last_message_at',30);
    const results=await Promise.all(conversations.map(async c=>({conversation:{conversation_key:c.conversation_key,title:c.title,job_id:c.job_id,job_name:c.job_name},messages:(await api.MessageRecord.filter({conversation_key:c.conversation_key},'-sent_at',100)).filter(m=>!m.retracted_at).map(m=>({id:m.id,text:m.text,sender:m.direction==='outgoing'?'You':m.sender,sent_at:m.sent_at,attachments:(m.attachments||[]).map(({file_uri,...a})=>a)}))})));
    return json({conversations:results});
   }
   if(action==='message_photo'){
    const m=await api.MessageRecord.get(validId(input.message_id));
    const a=m?.attachments?.find(x=>x.guid===input.attachment_guid);
    if(m?.retracted_at||!a?.file_uri)fail('Message attachment is not available.',404);
    return json(await readPrivateMessageAttachment(client,a,fetchImpl));
   }
   if(action==='save_report'){
    const refs=Array.isArray(input.posts)?input.posts:[],messageIds=Array.isArray(input.message_ids)?[...new Set(input.message_ids)]:[];
    if(refs.length>100||messageIds.length>100)fail('Choose up to 100 posts and 100 messages per report.');
    const ids=[...new Set(refs.map(p=>validId(p.project_id)))],source=new Map();
    for(const id of ids){const p=await oneProject(id);source.set(id,await postList(p));}
    const posts=[],seen=new Set();
    for(const ref of refs){const key=ref.project_id+':'+validId(ref.post_id);if(seen.has(key))continue;seen.add(key);const p=source.get(ref.project_id).find(p=>p.post_id===ref.post_id&&!p.deleted);if(!p)fail('A selected source post is unavailable. Refresh before saving.',409);posts.push(p);}
    const messages=[];
    for(const id of messageIds){const m=await api.MessageRecord.get(validId(id));if(!m||m.retracted_at)fail('A selected message is unavailable.',409);messages.push({id:m.id,source:'messages',conversation_key:m.conversation_key,message:clean(m.text,50000),sender:m.direction==='outgoing'?'You':m.sender,created_at:m.sent_at,attachments:(m.attachments||[]).map(({file_uri,...a})=>a)});}
    const job=input.job_id?await api.Jobs.get(validId(input.job_id)):null;
    if(input.job_id&&!job)fail('Choose an existing job.');
    const title=clean(input.title,500).trim();if(!title)fail('Enter a report title.');
    validateRange(input.report_date,input.report_date);
    if(!posts.length&&!messages.length&&!clean(input.notes,20000).trim())fail('Choose a source post, message or enter report notes.');
    const row={title,report_date:input.report_date,notes:clean(input.notes,20000),recipient:clean(input.recipient,320),job_id:job?.id||'',job_name:job?.canonical_name||'',posts,messages,source_checked_at:at,status:'draft'};
    if(input.report_id){const old=await api.ProbuildReportDraft.get(validId(input.report_id));if(!old)fail('Report not found.',404);if(key&&old.messages?.length)fail('Sign in with Gabriel’s owner account to access this private report.',403);return json({report:publicDraft(await api.ProbuildReportDraft.update(old.id,row))});}
    return json({report:publicDraft(await api.ProbuildReportDraft.create(row))});
   }
   fail('Unsupported action.');
  } catch(error) {
   if(error.publicMessage)return json({error:error.publicMessage},error.status||400);
   console.error('ProBuild control failed',error?.name||'Error');
   return json({error:'ProBuild request could not be completed. Refresh and retry; saved reports are retained.'},502);
  }
 };
}
Deno.serve(createProbuildControlHandler({getClient:createClientFromRequest,getToken:getProbuildIdToken}));

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { INBOX, OUTPUTS, PLAYBOOKS, HOSTS, digest, assert, enqueue, claim, report, ownedJob } from '../../shared/desktopQuoteRelayCore.js';
const DRIVE='https://www.googleapis.com/drive/v3';
const NAME='bluebeam-claude-pella-v1';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export default async function desktopQuoteRelay(req){
  if(req.method!=='POST')return reply({error:'POST required'},405);
  try{
    const base44=createClientFromRequest(req),db=base44.asServiceRole.entities;
    const role=req.headers.get('X-Quote-Role'),secret=req.headers.get('X-Quote-Token')||'';
    // Authenticate before obtaining the app-scoped Drive connection.
    if(!Object.hasOwn(HOSTS,role)||secret.length<40)return reply({error:'Worker authentication required'},401);
    const rows=await db.DesktopQuoteRelay.filter({name:NAME},undefined,2);
    if(rows.length!==1)return reply({error:'Relay not provisioned'},503);
    let row=rows[0];
    if(row.credentials?.[role]!==digest(secret))return reply({error:'Worker authentication required'},401);
    const body=await req.json();assert(JSON.stringify(body).length<12000000,'Request exceeds size limit');
    const now=new Date().toISOString(),state=structuredClone(row.state);
    const save=async()=>{
      const result=await db.DesktopQuoteRelay.updateMany({id:row.id,state_version:row.state_version},{$set:{state,state_version:row.state_version+1}});
      if(result.updated!==1)throw new Error('Concurrent update; retry the same request');
    };
    if(body.action==='heartbeat'){
      state.workers[role]={host:HOSTS[role],at:now,ready:body.ready===true,blockers:Array.isArray(body.blockers)?body.blockers.slice(0,10):[],version:'1'};
      await save();return reply({ok:true,dispatch_enabled:state.dispatch_enabled});
    }
    if(body.action==='status')return reply({enabled:state.enabled,dispatch_enabled:state.dispatch_enabled,workers:state.workers,jobs:state.jobs.map(j=>({id:j.id,job_name:j.job_name,status:j.status,stage:j.stage,questions:j.questions,folder_id:j.folder_id,quote_number:j.quote_number,updated_at:j.updated_at}))});
    if(body.action==='claim'){
      const job=claim(state,role,body.request_id,now);await save();return reply({job});
    }
    if(body.action==='report'){
      const job=report(state,role,body,now);await save();return reply({job});
    }
    const {accessToken}=await base44.asServiceRole.connectors.getConnection('googledrive');
    assert(accessToken,'Drive connection unavailable');
    const gf=async(path,options={})=>{
      const response=await fetch(DRIVE+path,{...options,headers:{Authorization:`Bearer ${accessToken}`,...options.headers},signal:AbortSignal.timeout(25000)});
      if(!response.ok)throw new Error(`Drive HTTP ${response.status}`);return response;
    };
    const meta=async id=>(await gf(`/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,mimeType,parents,version,modifiedTime,md5Checksum,size,trashed,webViewLink`)).json();
    const account=await (await gf('/about?fields=user(emailAddress)')).json();
    assert(account.user?.emailAddress==='gabriel.fronk.wd@gmail.com','Unexpected Drive account');
    if(body.action==='discover'){
      assert(role==='takeoff','Only the intake computer discovers plans');assert(state.enabled,'Intake paused');
      let page='',files=[];
      do{
        const query=new URLSearchParams({q:`'${INBOX}' in parents and trashed=false`,fields:'nextPageToken,files(id,name,mimeType,parents,version,modifiedTime,md5Checksum,size)',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(page?{pageToken:page}:{})});
        const result=await (await gf('/files?'+query)).json();files.push(...result.files);page=result.nextPageToken||'';
      }while(page&&files.length<500);
      assert(!page,'Inbox too large to scan safely');
      const books=await Promise.all(PLAYBOOKS.map(meta));
      const stable=files.filter(f=>f.mimeType==='application/pdf'&&Date.now()-Date.parse(f.modifiedTime)>60000);
      enqueue(state,stable,books,now);state.last_scan_at=now;await save();return reply({discovered:stable.length,jobs:state.jobs.length,excluded:files.filter(f=>state.excluded.includes(f.id)).length});
    }
    const j=ownedJob(state,role,body.job_id,body.run_id);
    if(body.action==='download'){
      const f=await meta(j.source.id);assert(!f.trashed&&f.parents?.includes(INBOX)&&f.version===j.source.version&&f.md5Checksum===j.source.md5Checksum,'Source file changed or left the intake folder');
      const size=Number(f.size);assert(size>0&&size<250000000,'Unsupported plan file size');
      const start=Number(body.offset||0),end=Math.min(start+1048576-1,size-1);
      assert(Number.isSafeInteger(start)&&start>=0&&start<size,'Invalid byte offset');
      const response=await gf(`/files/${encodeURIComponent(f.id)}?alt=media`,{headers:{Range:`bytes=${start}-${end}`}});
      assert(response.status===206||start===0&&size<=1048576,'Drive did not honor byte range');
      const bytes=new Uint8Array(await response.arrayBuffer());assert(bytes.length===end-start+1,'Incomplete plan chunk');
      let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return reply({content_b64:btoa(binary),offset:start,size,md5Checksum:f.md5Checksum});
    }
    if(body.action==='playbooks'){
      const books=[];
      for(const f of j.playbooks){
        const current=await meta(f.id);assert(current.version===f.version,'Playbook revision changed; reconcile the job');
        const text=await (await gf(`/files/${encodeURIComponent(f.id)}/export?mimeType=text%2Fplain`)).text();
        books.push({id:f.id,version:f.version,name:f.name,text});
      }
      return reply({books});
    }
    if(body.action==='upload'){
      assert(['takeoff','pella'].includes(role),'Wrong role');
      assert(typeof body.name==='string'&&/^[^\\/\x00-\x1f]{1,150}$/.test(body.name),'Invalid output name');
      assert(['application/pdf','text/csv','application/json','text/markdown','text/plain'].includes(body.mime_type),'Unsupported output type');
      const bytes=Uint8Array.from(atob(body.content_b64),c=>c.charCodeAt(0));assert(bytes.length>0&&bytes.length<=8000000,'Output must be 1 byte through 8 MB');
      const {createHash}=await import('node:crypto');const md5=createHash('md5').update(bytes).digest('hex');
      const previous=j.outputs.find(o=>o.name===body.name);
      if(previous){assert(previous.md5Checksum===md5,'Output name already exists with different content');const actual=await meta(previous.id);assert(actual.md5Checksum===md5&&actual.parents?.includes(j.folder_id)&&!actual.trashed,'Uploaded output changed');return reply({file:actual});}
      if(!j.folder_id){
        // Reserve a Drive id durably before creating the folder, so a lost response is recoverable.
        const generated=await (await gf('/files/generateIds?count=1&space=drive&type=files')).json();
        j.folder_id=generated.ids[0];await save();row={...row,state_version:row.state_version+1};
      }
      let folder;try{folder=await meta(j.folder_id);}catch(e){if(!String(e.message).includes('404'))throw e;}
      if(!folder){folder=await (await gf('/files?fields=id,name,parents,webViewLink',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:j.folder_id,name:j.job_name.replace(/[\\/\x00-\x1f]/g,' ').slice(0,180),mimeType:'application/vnd.google-apps.folder',parents:[OUTPUTS]})})).json();}
      assert(folder.parents?.includes(OUTPUTS),'Unexpected output folder parent');
      j.pending_uploads??={};
      let pending=j.pending_uploads[body.name];
      if(pending)assert(pending.md5===md5,'Pending output content changed');
      else{
        const ids=await (await gf('/files/generateIds?count=1&space=drive&type=files')).json();
        pending={id:ids.ids[0],md5};j.pending_uploads[body.name]=pending;await save();row={...row,state_version:row.state_version+1};
      }
      let existing;try{existing=await meta(pending.id);}catch(e){if(!String(e.message).includes('404'))throw e;}
      if(!existing){
        const form=new FormData();form.append('metadata',new Blob([JSON.stringify({id:pending.id,name:body.name,parents:[j.folder_id]})],{type:'application/json'}));form.append('file',new Blob([bytes],{type:body.mime_type}),body.name);
        const upload=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`},body:form,signal:AbortSignal.timeout(40000)});
        if(!upload.ok)throw new Error(`Drive upload HTTP ${upload.status}`);
      }
      const actual=await meta(pending.id);assert(actual.parents?.includes(j.folder_id)&&actual.md5Checksum===md5&&Number(actual.size)===bytes.length&&!actual.trashed,'Output verification failed');
      j.outputs.push({...actual,verified:true});delete j.pending_uploads[body.name];await save();return reply({file:actual});
    }
    return reply({error:'Unknown action'},400);
  }catch(error){
    const message=String(error?.message||'Relay request failed');
    // No OAuth tokens or request bodies are logged or echoed.
    return reply({error:message.slice(0,300)},message.startsWith('Concurrent update')?409:400);
  }
}


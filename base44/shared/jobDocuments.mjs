const ROOT='1F_PgUPEuvyvzCk92tdaFiwioLSack4iS';
import { canReadJobDocuments, canWriteJobDocuments } from './jobDocumentsAccess.mjs';
const DRIVE='https://www.googleapis.com/drive/v3';
const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const JSON_HEADERS={'Content-Type':'application/json'};
// Files dropped on Budget & Orders go to the job folder in resumable chunks (Gabriel, Oct 30):
// each chunk is one call, so a large drawing set never has to fit in one request.
export const MAX_UPLOAD_BYTES=50*1024*1024;
export const UPLOAD_CHUNK_BYTES=2*1024*1024; // Drive wants multiples of 256 KiB except the last
// A pasted Drive folder link or a bare folder ID -> the ID ('' when it is neither).
export function driveFolderIdFrom(value){
 const s=String(value||'').trim();if(/^[\w-]{10,100}$/.test(s))return s;
 try{const u=new URL(s);if(!/(^|\.)drive\.google\.com$/.test(u.hostname))return '';
  const m=u.pathname.match(/\/folders\/([\w-]{10,100})/);const id=m?m[1]:u.searchParams.get('id')||'';
  return /^[\w-]{10,100}$/.test(id)?id:'';}catch{return '';}
}
// Only Drive's own resumable-upload session links are ever written to.
export function isDriveUploadSession(value){
 try{const u=new URL(String(value||''));return u.protocol==='https:'&&u.hostname==='www.googleapis.com'&&u.pathname==='/upload/drive/v3/files'&&Boolean(u.searchParams.get('upload_id'));}catch{return false;}
}
// '' when the chunk fits the upload, else why not.
export function uploadChunkProblem(offset,length,total){
 if(!Number.isSafeInteger(total)||total<1||total>MAX_UPLOAD_BYTES)return 'The file must be under 50 MB.';
 if(!Number.isSafeInteger(offset)||offset<0||length<1||length>UPLOAD_CHUNK_BYTES||offset+length>total)return 'That part of the file does not fit the upload.';
 if(offset+length<total&&length%(256*1024)!==0)return 'Upload parts must be whole 256 KB blocks.';
 return '';
}
const cleanFileName=value=>String(value||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
const cleanMime=value=>/^[\w.+-]{1,60}\/[\w.+-]{1,100}$/.test(String(value||''))?String(value):'application/octet-stream';
function base64Bytes(value){const bin=atob(String(value||''));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
const reply=(body,status=200)=>Response.json(body,{status});
const clean=value=>String(value||'').replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
const escaped=value=>value.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
export function folderName(job){return clean([job.canonical_name,job.address].filter(Boolean).join(' - '))||'';}
// Drive folder rules shared by the job-documents endpoint and the calendar
// file copier: folders live in Glass Forge Jobs, directly or under a builder.
export function jobFolderTools({drive,api,job}){
   const folder=async id=>drive('/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,parents,webViewLink,trashed');
   const children=async(parent,name)=>{
    const q=`'${escaped(parent)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`+(name?` and name='${escaped(name)}'`:'');
    return (await drive('/files?q='+encodeURIComponent(q)+'&fields=nextPageToken,files(id,name,mimeType,parents,webViewLink,trashed)&pageSize=100')).files||[];
   };
   const validParent=async f=>{
    if(f.trashed||f.mimeType!=='application/vnd.google-apps.folder')return false;
    if(f.parents?.includes(ROOT))return true;
    for(const parent of f.parents||[]){const p=await folder(parent);if(p.parents?.includes(ROOT))return true;}
    return false;
   };
   const save=async f=>{
    if(!await validParent(f))return {status:400,body:{error:'Choose a folder directly in Glass Forge Jobs or a builder folder beneath it.'}};
    if(!f.webViewLink)return {status:502,body:{error:'Drive did not return a usable folder link.'}};
    await api.Jobs.update(job.id,{drive_job_folder_id:f.id,drive_job_folder_url:f.webViewLink});
    job.drive_job_folder_id=f.id;job.drive_job_folder_url=f.webViewLink;
    return {status:200,body:{ok:true,folder:{id:f.id,name:f.name,url:f.webViewLink}}};
   };
   return {folder,children,validParent,save};
}

// Link the job's existing folder, or create Glass Forge Jobs/Builder/Job - Address.
export async function ensureJobFolder({drive,api,job}){
    const {folder,children,save}=jobFolderTools({drive,api,job});
    if(job.drive_job_folder_id)return save(await folder(job.drive_job_folder_id));
    const name=folderName(job);if(!name)return {status:400,body:{error:'Enter a job name.'}};
    // Never adopt a customer-name-only folder: it could belong to a different job.
    const builder=clean(job.builder)||'Unassigned';
    const bs=await children(ROOT,builder);if(bs.length>1)return {status:409,body:{error:'Multiple builder folders have this name. Review in Drive.'}};
    let builderFolder=bs[0];if(!builderFolder){builderFolder=await drive('/files?fields=id,name,mimeType,parents,webViewLink',{method:'POST',headers:JSON_HEADERS,body:JSON.stringify({name:builder,mimeType:'application/vnd.google-apps.folder',parents:[ROOT]})});}
    const exact=await children(builderFolder.id,name);if(exact.length>1)return {status:409,body:{error:'Multiple matching job folders. Choose one in Drive.'}};
    const f=exact[0]||await drive('/files?fields=id,name,mimeType,parents,webViewLink',{method:'POST',headers:JSON_HEADERS,body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[builderFolder.id]})});
    return save(f);
}

export function createJobDocumentsHandler({getClient,request=fetch}={}){
 return async req=>{
  if(req.method!=='POST')return reply({error:'POST required.'},405);
  try{
   const client=await getClient(req),user=await client.auth.me().catch(()=>null);
   if(!canReadJobDocuments(user))return reply({error:'Sign in required.'},401);
   const input=await req.json();
   if(input.action!=='list'&&!canWriteJobDocuments(user))return reply({error:'Folder linking is not available.'},403);
   const jobId=String(input.job_id||'');if(!jobId)return reply({error:'Select a job.'},400);
   const api=client.asServiceRole.entities,job=await api.Jobs.get(jobId).catch(()=>null);
   if(!job)return reply({error:'Job not found.'},404);
   if(!['ensure_folder','attach_folder','unlink_folder','list','upload_start','upload_chunk'].includes(input.action))return reply({error:'Unsupported action.'},400);
   if(input.action==='unlink_folder'){
    await api.Jobs.update(job.id,{drive_job_folder_id:null,drive_job_folder_url:null});
    return reply({ok:true,folder:null});
   }
   const {accessToken}=await client.asServiceRole.connectors.getConnection('googledrive');
   if(!accessToken)return reply({error:'Google Drive is not connected.'},503);
   const drive=async(path,init={})=>{
    const r=await request(DRIVE+path,{...init,headers:{Authorization:'Bearer '+accessToken,...init.headers}});
    if(!r.ok)throw Error('Drive request failed ('+r.status+').');return r.json();
   };
   const {folder,save,validParent}=jobFolderTools({drive,api,job});
   if(input.action==='attach_folder'){
    const id=driveFolderIdFrom(input.folder_id);if(!id)return reply({error:'Paste the Drive folder link or its ID.'},400);
    const r=await save(await folder(id));return reply(r.body,r.status);
   }
   if(input.action==='upload_start'){
    const name=cleanFileName(input.file_name),size=Number(input.size);
    if(!name)return reply({error:'The file needs a name.'},400);
    if(!Number.isSafeInteger(size)||size<1||size>MAX_UPLOAD_BYTES)return reply({error:'The file must be under 50 MB.'},400);
    // The job's linked folder (still inside Glass Forge Jobs), else the folder ensure_folder links.
    let target;
    if(job.drive_job_folder_id){const f=await folder(job.drive_job_folder_id);if(!await validParent(f))return reply({error:'Stored folder is no longer in Glass Forge Jobs.'},409);target={id:f.id,name:f.name,url:f.webViewLink};}
    else{const r=await ensureJobFolder({drive,api,job});if(r.status!==200)return reply(r.body,r.status);target=r.body.folder;}
    const started=await request(UPLOAD+'?uploadType=resumable&fields=id,name,webViewLink',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':cleanMime(input.mime_type),'X-Upload-Content-Length':String(size)},body:JSON.stringify({name,parents:[target.id]})});
    const session=started.headers.get('location')||'';
    if(!started.ok||!isDriveUploadSession(session))return reply({error:'Drive would not start the upload ('+started.status+').'},502);
    return reply({ok:true,upload_url:session,chunk_bytes:UPLOAD_CHUNK_BYTES,folder:target});
   }
   if(input.action==='upload_chunk'){
    const session=String(input.upload_url||'');if(!isDriveUploadSession(session))return reply({error:'That upload link is not a Drive upload.'},400);
    const bytes=base64Bytes(input.data),offset=Number(input.offset),total=Number(input.total);
    const problem=uploadChunkProblem(offset,bytes.length,total);if(problem)return reply({error:problem},400);
    // 308 here is Drive's "resume incomplete", not a redirect to follow.
    const sent=await request(session,{method:'PUT',redirect:'manual',headers:{Authorization:'Bearer '+accessToken,'Content-Range':`bytes ${offset}-${offset+bytes.length-1}/${total}`},body:bytes});
    if(sent.status===308){const range=sent.headers.get('range')||'';return reply({ok:true,done:false,received:range?Number(range.split('-')[1])+1:0});}
    if(!sent.ok)return reply({error:'Drive stopped the upload ('+sent.status+'). Try again.'},502);
    const f=await sent.json();
    return reply({ok:true,done:true,file:{id:f.id,name:f.name,url:f.webViewLink||'https://drive.google.com/file/d/'+encodeURIComponent(f.id)+'/view'}});
   }
   if(input.action==='ensure_folder'){const r=await ensureJobFolder({drive,api,job});return reply(r.body,r.status);}
   if(!job.drive_job_folder_id)return reply({folder:null,files:[],status:'unlinked'});
   const f=await folder(job.drive_job_folder_id);if(!await validParent(f))return reply({error:'Stored folder is no longer in Glass Forge Jobs.'},409);
   const q=`'${escaped(f.id)}' in parents and trashed=false`;
   const files=[],seen=new Set();let page='';do{
    const r=await drive('/files?q='+encodeURIComponent(q)+'&fields=nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,parents)&pageSize=100'+(page?'&pageToken='+encodeURIComponent(page):''));
    for(const item of r.files||[])if(item.mimeType!=='application/vnd.google-apps.folder'&&item.webViewLink&&!seen.has(item.id)){files.push({id:item.id,name:item.name,mime_type:item.mimeType,url:item.webViewLink,modified_at:item.modifiedTime});seen.add(item.id);}
    page=r.nextPageToken||'';if(files.length>=500)break;
   }while(page);
   return reply({folder:{id:f.id,name:f.name,url:f.webViewLink},files,complete:!page});
  }catch(error){console.error('job documents',error?.name||'Error');return reply({error:'Job documents could not be loaded. Check the Drive connection and folder permissions.'},502);}
 };
}

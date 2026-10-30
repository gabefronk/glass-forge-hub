import {canReadJobDocuments,canWriteJobDocuments} from "../base44/shared/jobDocumentsAccess.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJobDocumentsHandler,folderName,driveFolderIdFrom,isDriveUploadSession,uploadChunkProblem,UPLOAD_CHUNK_BYTES} from '../base44/shared/jobDocuments.mjs';
const ROOT='1F_PgUPEuvyvzCk92tdaFiwioLSack4iS';
const FOLDER='1qVgcBVnKk8Ps2BV5Ak9eVmdN8NKmAAzy';
const job={id:'job1',canonical_name:'AV24',address:'1212 North Luna Circle',drive_job_folder_id:FOLDER};
function setup({user={role:'admin',email:'gabefronk@gmail.com'},sameRoot=true}={}){
 const writes=[];const record={...job};const folders={[FOLDER]:{id:FOLDER,name:'Justin Hutchins',mimeType:'application/vnd.google-apps.folder',parents:[sameRoot?ROOT:'outside'],webViewLink:'https://drive.google.com/folder-real'}};
 const api={Jobs:{get:async id=>id===record.id?record:null,update:async(id,p)=>{writes.push(p);Object.assign(record,p);}}};
 const request=async url=>{const id=url.split('/files/')[1]?.split('?')[0];if(id&&folders[id])return Response.json(folders[id]);if(id==='outside')return Response.json({id:'outside',parents:[],mimeType:'application/vnd.google-apps.folder'});if(url.includes('/files?q='))return Response.json({files:[]});return new Response('missing',{status:404});};
 const handler=createJobDocumentsHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:api,connectors:{getConnection:async()=>({accessToken:'test'})}}}),request});
 return {writes,call:async body=>handler(new Request('https://app.invalid',{method:'POST',body:JSON.stringify(body)}))};
}
test('signed-in crew can attach; verifies folder containment and does not invent link',async()=>{
 const crew=setup({user:{role:'user',email:'crew@example.com'}});assert.equal((await crew.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER})).status,200);assert.equal(crew.writes.length,1);
 const outside=setup({user:{role:'user',email:'crew@example.com'},sameRoot:false});assert.equal((await outside.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER})).status,400);assert.equal(outside.writes.length,0);
 const owner=setup();const r=await owner.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER});assert.equal(r.status,200);assert.equal(owner.writes[0].drive_job_folder_url,'https://drive.google.com/folder-real');
});
test('folder names require both job name and address when available',()=>assert.equal(folderName({canonical_name:'AV24',address:'1212 North Luna Circle'}),'AV24 - 1212 North Luna Circle'));

test('temporary folder read and linking policy allows signed-in crew but not anonymous users',async()=>{
 assert.equal(canReadJobDocuments(null),false);assert.equal(canReadJobDocuments({role:'user'}),true);assert.equal(canWriteJobDocuments(null),false);assert.equal(canWriteJobDocuments({role:'user'}),true);
 const crew=setup({user:{role:'user',email:'crew@example.com'}});const r=await crew.call({action:'list',job_id:'job1'});assert.equal(r.status,200);const body=await r.json();assert.equal(body.folder.url,'https://drive.google.com/folder-real');assert.deepEqual(body.files,[]);assert.equal(crew.writes.length,0);
 assert.equal((await crew.call({action:'ensure_folder',job_id:'job1'})).status,200);assert.equal((await crew.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER})).status,200);
 assert.equal((await crew.call({action:'unlink_folder',job_id:'job1'})).status,200);assert.deepEqual(crew.writes.at(-1),{drive_job_folder_id:null,drive_job_folder_url:null});
 const unlinked=await crew.call({action:'list',job_id:'job1'});assert.equal((await unlinked.json()).status,'unlinked');
 const anonymous=setup({user:null});assert.equal((await anonymous.call({action:'list',job_id:'job1'})).status,401);
});

// Campbell Add-on (Oct 30): a pasted folder link ties the job to its real folder.
const CAMPBELL='1H1yEk9lo06ZU4l9sRJ-GLbHXPjwlOEF6';
test('a pasted Drive folder link or a bare ID gives the folder ID; anything else gives nothing',()=>{
 assert.equal(driveFolderIdFrom(CAMPBELL),CAMPBELL);
 assert.equal(driveFolderIdFrom(` https://drive.google.com/drive/folders/${CAMPBELL}?usp=sharing `),CAMPBELL);
 assert.equal(driveFolderIdFrom(`https://drive.google.com/drive/u/1/folders/${CAMPBELL}`),CAMPBELL);
 assert.equal(driveFolderIdFrom(`https://drive.google.com/open?id=${CAMPBELL}`),CAMPBELL);
 assert.equal(driveFolderIdFrom(`https://evil.example/drive/folders/${CAMPBELL}`),'');
 assert.equal(driveFolderIdFrom('Campbell Add-on'),'');
 assert.equal(driveFolderIdFrom(''),'');
});
test('attach_folder accepts the folder link Gabe copies from Drive',async()=>{
 const owner=setup();const r=await owner.call({action:'attach_folder',job_id:'job1',folder_id:`https://drive.google.com/drive/folders/${FOLDER}?usp=drive_link`});
 assert.equal(r.status,200);assert.equal(owner.writes[0].drive_job_folder_id,FOLDER);
 assert.equal((await owner.call({action:'attach_folder',job_id:'job1',folder_id:'not a link'})).status,400);
});
test('only Drive upload sessions are written to, in whole 256 KB parts',()=>{
 assert.equal(isDriveUploadSession('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc'),true);
 assert.equal(isDriveUploadSession('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable'),false);
 assert.equal(isDriveUploadSession('https://evil.example/upload/drive/v3/files?upload_id=abc'),false);
 assert.equal(isDriveUploadSession('http://www.googleapis.com/upload/drive/v3/files?upload_id=abc'),false);
 assert.equal(uploadChunkProblem(0,UPLOAD_CHUNK_BYTES,UPLOAD_CHUNK_BYTES+5),'');
 assert.equal(uploadChunkProblem(UPLOAD_CHUNK_BYTES,5,UPLOAD_CHUNK_BYTES+5),'');
 assert.match(uploadChunkProblem(0,1000,5000),/256 KB/);
 assert.match(uploadChunkProblem(4000,2000,5000),/does not fit/);
 assert.match(uploadChunkProblem(0,10,51*1024*1024),/50 MB/);
});
test('upload_start opens a resumable upload in the job folder; upload_chunk sends parts until Drive returns the file',async()=>{
 const sent=[];const SESSION='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=s1';
 const record={...job};
 const request=async(url,init={})=>{
  sent.push({url,method:init.method||'GET',headers:init.headers||{},body:init.body});
  if(url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields'))return new Response(null,{status:200,headers:{location:SESSION}});
  if(url===SESSION){const end=Number(init.headers['Content-Range'].split('-')[1].split('/')[0]);const total=Number(init.headers['Content-Range'].split('/')[1]);
   return end+1<total?new Response(null,{status:308,headers:{range:`bytes=0-${end}`}}):Response.json({id:'file1',name:'Cambell front .png',webViewLink:'https://drive.google.com/file/d/file1/view'});}
  const id=url.split('/files/')[1]?.split('?')[0];if(id===FOLDER)return Response.json({id:FOLDER,name:'Campbell Add-on',mimeType:'application/vnd.google-apps.folder',parents:[ROOT],webViewLink:'https://drive.google.com/folder-real'});
  return new Response('missing',{status:404});
 };
 const handler=createJobDocumentsHandler({getClient:async()=>({auth:{me:async()=>({role:'admin',email:'gabefronk@gmail.com'})},asServiceRole:{entities:{Jobs:{get:async id=>id===record.id?record:null,update:async()=>{}}},connectors:{getConnection:async()=>({accessToken:'test'})}}}),request});
 const call=async body=>{const r=await handler(new Request('https://app.invalid',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
 const start=await call({action:'upload_start',job_id:'job1',file_name:'Cambell front .png',mime_type:'image/png',size:UPLOAD_CHUNK_BYTES+3});
 assert.equal(start.status,200);assert.equal(start.data.upload_url,SESSION);assert.equal(start.data.folder.name,'Campbell Add-on');
 const opened=sent.find(s=>s.method==='POST');assert.deepEqual(JSON.parse(opened.body),{name:'Cambell front .png',parents:[FOLDER]});assert.equal(opened.headers['X-Upload-Content-Type'],'image/png');
 const first=await call({action:'upload_chunk',job_id:'job1',upload_url:SESSION,offset:0,total:UPLOAD_CHUNK_BYTES+3,data:Buffer.alloc(UPLOAD_CHUNK_BYTES,1).toString('base64')});
 assert.deepEqual(first.data,{ok:true,done:false,received:UPLOAD_CHUNK_BYTES});
 const last=await call({action:'upload_chunk',job_id:'job1',upload_url:SESSION,offset:UPLOAD_CHUNK_BYTES,total:UPLOAD_CHUNK_BYTES+3,data:Buffer.from('abc').toString('base64')});
 assert.equal(last.data.done,true);assert.equal(last.data.file.id,'file1');
 assert.equal(sent.filter(s=>s.url===SESSION).at(-1).headers['Content-Range'],`bytes ${UPLOAD_CHUNK_BYTES}-${UPLOAD_CHUNK_BYTES+2}/${UPLOAD_CHUNK_BYTES+3}`);
 assert.equal((await call({action:'upload_chunk',job_id:'job1',upload_url:'https://evil.example/x?upload_id=1',offset:0,total:3,data:'YWJj'})).status,400);
 assert.equal((await call({action:'upload_start',job_id:'job1',file_name:'big.pdf',size:60*1024*1024})).status,400);
});


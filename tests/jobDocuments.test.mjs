import {canReadJobDocuments} from "../base44/shared/jobDocumentsAccess.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJobDocumentsHandler,folderName} from '../base44/shared/jobDocuments.mjs';
const ROOT='1F_PgUPEuvyvzCk92tdaFiwioLSack4iS';
const FOLDER='1qVgcBVnKk8Ps2BV5Ak9eVmdN8NKmAAzy';
const job={id:'job1',canonical_name:'AV24',address:'1212 North Luna Circle',drive_job_folder_id:FOLDER};
function setup({user={role:'admin',email:'gabefronk@gmail.com'},sameRoot=true}={}){
 const writes=[];const folders={[FOLDER]:{id:FOLDER,name:'Justin Hutchins',mimeType:'application/vnd.google-apps.folder',parents:[sameRoot?ROOT:'outside'],webViewLink:'https://drive.google.com/folder-real'}};
 const api={Jobs:{get:async id=>id===job.id?job:null,update:async(id,p)=>{writes.push(p);Object.assign(job,p);}}};
 const request=async url=>{const id=url.split('/files/')[1]?.split('?')[0];if(id&&folders[id])return Response.json(folders[id]);if(id==='outside')return Response.json({id:'outside',parents:[],mimeType:'application/vnd.google-apps.folder'});if(url.includes('/files?q='))return Response.json({files:[]});return new Response('missing',{status:404});};
 const handler=createJobDocumentsHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:api,connectors:{getConnection:async()=>({accessToken:'test'})}}}),request});
 return {writes,call:async body=>handler(new Request('https://app.invalid',{method:'POST',body:JSON.stringify(body)}))};
}
test('only owner can attach; verifies folder containment and does not invent link',async()=>{
 const denied=setup({user:{role:'user',email:'crew@example.com'}});assert.equal((await denied.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER})).status,403);assert.equal(denied.writes.length,0);
 const outside=setup({sameRoot:false});assert.equal((await outside.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER})).status,400);assert.equal(outside.writes.length,0);
 const owner=setup();const r=await owner.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER});assert.equal(r.status,200);assert.equal(owner.writes[0].drive_job_folder_url,'https://drive.google.com/folder-real');
});
test('folder names require both job name and address when available',()=>assert.equal(folderName({canonical_name:'AV24',address:'1212 North Luna Circle'}),'AV24 - 1212 North Luna Circle'));

test('temporary folder read policy allows signed-in crew but not anonymous users',async()=>{
 assert.equal(canReadJobDocuments(null),false);assert.equal(canReadJobDocuments({role:'user'}),true);
 const crew=setup({user:{role:'user',email:'crew@example.com'}});const r=await crew.call({action:'list',job_id:'job1'});assert.equal(r.status,200);const body=await r.json();assert.equal(body.folder.url,'https://drive.google.com/folder-real');assert.deepEqual(body.files,[]);assert.equal(crew.writes.length,0);
 assert.equal((await crew.call({action:'ensure_folder',job_id:'job1'})).status,403);assert.equal((await crew.call({action:'attach_folder',job_id:'job1',folder_id:FOLDER})).status,403);
 const anonymous=setup({user:null});assert.equal((await anonymous.call({action:'list',job_id:'job1'})).status,401);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildJobDocumentsEntry} from '../scripts/build-job-documents-entry.mjs';

// Published functions that import shared .mjs modules do not load (see REVIEW.md §1),
// so job-documents must be the self-contained build of the tested modules.
const entry=()=>fs.readFileSync(new URL('../base44/functions/job-documents/entry.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('published job-documents entry is the current build and has no relative imports',()=>{
 assert.equal(entry(),buildJobDocumentsEntry(),'Rebuild with: node scripts/build-job-documents-entry.mjs');
 const imports=[...entry().matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map(m=>m[1]);
 assert.deepEqual(imports,['npm:@base44/sdk@0.8.48']);
 assert.doesNotMatch(entry(),/^export /m);
});

test('deployed job-documents handler serves auth and validation paths',async()=>{
 let handler;const writes=[];
 const load=user=>{
  const source=entry().replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source,{createClientFromRequest:()=>({auth:{me:async()=>user},asServiceRole:{entities:{Jobs:{get:async id=>id==='job1'?{id:'job1'}:null,update:async(id,p)=>writes.push(p)}}}}),Deno:{serve:fn=>{handler=fn;}},Response,JSON,fetch:async()=>{throw Error('no network');},console,encodeURIComponent,String,Boolean,Set,Error});
  return async body=>{const r=await handler(new Request('https://app.test/job-documents',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
 };
 assert.equal((await load(null)({action:'list',job_id:'job1'})).status,401);
 const call=load({role:'user',email:'crew@example.com'});
 assert.equal((await call({action:'list'})).status,400);
 assert.equal((await call({action:'list',job_id:'missing'})).status,404);
 const r=await call({action:'unlink_folder',job_id:'job1'});
 assert.equal(r.status,200);assert.deepEqual(r.data,{ok:true,folder:null});
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{drive_job_folder_id:null,drive_job_folder_url:null}]);
});

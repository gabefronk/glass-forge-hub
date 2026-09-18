import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildTodosEntry} from '../scripts/build-todos-entry.mjs';

// Root cause of the broken To-do section: the published `todos` function imported
// ../../shared/todoService.mjs, which does not load once deployed. The entry must be
// the self-contained build of the tested module, with no relative imports.
const entry=()=>fs.readFileSync(new URL('../base44/functions/todos/entry.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('published todos entry is the current build of the tested module and has no relative imports',()=>{
 assert.equal(entry(),buildTodosEntry(),'Rebuild with: node scripts/build-todos-entry.mjs');
 const imports=[...entry().matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map(m=>m[1]);
 assert.deepEqual(imports,['npm:@base44/sdk@0.8.48']);
 assert.doesNotMatch(entry(),/^export /m);
});

function load(user,members){
 let handler;
 const entities={
  TeamMember:{list:async()=>structuredClone(members)},
  TodoTask:{filter:async()=>[]},
 };
 const source=entry().replace(/^import .*;\n/gm,'');
 vm.runInNewContext(source,{createClientFromRequest:()=>({auth:{me:async()=>user},asServiceRole:{entities}}),Deno:{serve:fn=>{handler=fn;}},Response,JSON,crypto,console});
 return async body=>{const r=await handler(new Request('https://app.test/todos',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
}
const gabriel={id:'mg',member_key:'gabriel',display_name:'Gabriel',auth_user_ids:['ga'],active:true,revision:0,management_lock:'',seed_state:'complete'};

test('deployed todos handler serves owner access and lists',async()=>{
 const call=load({id:'ga',email:'GabeFronk@gmail.com',role:'admin'},[gabriel]);
 assert.deepEqual((await call({action:'access'})).data,{ok:true,allowed:true,owner:true,member_id:'mg'});
 const list=await call({action:'list',member_id:'mine',offset:0});
 assert.equal(list.status,200);assert.equal(list.data.owner,true);assert.deepEqual(list.data.tasks,[]);
});

test('deployed todos handler keeps unlinked accounts out',async()=>{
 const r=await load({id:'x',email:'someone@example.com',role:'admin'},[gabriel])({action:'access'});
 assert.equal(r.status,403);
 assert.equal(r.data.error,'This sign-in has no to-do access.');
});

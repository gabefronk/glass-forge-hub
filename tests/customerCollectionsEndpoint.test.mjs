import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../base44/shared/customerCollectionsHandle.js';
const job='a'.repeat(24),id='b'.repeat(24),owner='6a7f0d834a5f825c724273ea';
const page=items=>({items,has_more:false,next_cursor:null});
function fixture(){let r={id,job_id:job,fee_type:'profit_split',updated_date:'v1',invoice_month:'2026-09',sale_price:null,cost:null};let writes=[];
 const note={id:'c'.repeat(24),job_id:job,completion:'complete',note_date:'2026-10-16'};
 const a={authMe:async()=>({id:owner}),now:()=> '2026-10-17T20:00:00Z',lineGet:async()=>structuredClone(r),jobGet:async()=>({id:job}),
 notesFilter:async()=>page([note]),linesFilter:async()=>page([r]),closedList:async()=>page([]),
 linesList:async()=>page([r]),notesList:async()=>page([note]),jobsList:async()=>page([{id:job,canonical_name:'329'}]),
 lineUpdate:async(_,p)=>{writes.push(p);r={...r,...p,updated_date:'v2'};}};
 return {a,writes};}
const req=b=>({json:async()=>b});
test('list is read only and enrollment checks fresh identity; paid reuses exact line',async()=>{
 const f=fixture();assert.equal((await handle(req({action:'list'}),f.a)).body.items.length,1);assert.equal(f.writes.length,0);
 const enrolled=await handle(req({action:'enroll',line_id:id,expected_updated_date:'v1',review_confirmed:true}),f.a);
 assert.equal(enrolled.status,200);assert.equal(enrolled.body.quickbooks_sent,false);
 const paid=await handle(req({action:'paid',line_id:id,expected_updated_date:'v2',review_confirmed:true,received_date:'2026-10-17',reference:'check 123'}),f.a);
 assert.equal(paid.status,200);assert.equal(paid.body.line.invoice_month,'2026-10');assert.equal(paid.body.line.id,id);
 assert.equal(paid.body.line.sale_price,null);assert.equal(paid.body.line.cost,null);
});
test('duplicate line, truncated evidence and merged job fail without writes',async()=>{
 for(const mutate of [a=>a.linesFilter=async()=>page([{id},{id:'x'}]),a=>a.notesFilter=async()=>[],a=>a.jobGet=async()=>({id:job,merged_into:'other'})]){
 const f=fixture();mutate(f.a);const r=await handle(req({action:'enroll',line_id:id,expected_updated_date:'v1',review_confirmed:true}),f.a);
 assert.equal(r.status,409);assert.equal(f.writes.length,0);
 }
});

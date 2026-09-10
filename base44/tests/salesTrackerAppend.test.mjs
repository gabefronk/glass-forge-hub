import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { TRACKER_FIELDS, TRACKER_HEADERS, planTrackerAppend, applyTrackerAppends } from '../shared/salesTrackerAppend.js';
import { parseTrackerDelta, createTrackerAppendHandler } from '../shared/salesTrackerAppendService.js';

const row=(i,overrides={})=>Object.fromEntries(Object.entries({
 month_paid:'',closed:'',order_date:'2026-09-09',po:'PO-'+i,oe:'OE-'+i,builder:'Sample Builder',subdivision:'Sample',
 lot:String(i).padStart(3,'0'),arrival_date:'2026-10-01',sale_price:1234.56,notes:'Captured note',order_folder_url:'https://example.com/order/'+i,source_row:i+2,...overrides
}));
function workbook(rows,mutate=()=>{}) {
 const book=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet([TRACKER_HEADERS,...rows.map(r=>TRACKER_FIELDS.map(k=>r[k]))]);
 mutate(sheet);XLSX.utils.book_append_sheet(book,sheet,'DAILY SALES');
 return new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'}));
}
const delta=Array.from({length:11},(_,i)=>row(i+1));
test('11-row delta keeps all 12 fields and preserves leading-zero lots and folder URLs',()=>{
 const parsed=parseTrackerDelta(XLSX,workbook(delta),'delta.xlsx');
 assert.equal(parsed.length,11);
 assert.equal(parsed[0].lot,'001');
 assert.equal(parsed[10].order_folder_url,'https://example.com/order/11');
 assert.equal(parsed[0].sale_price,1234.56);
 const csv=[TRACKER_HEADERS.join(','),TRACKER_FIELDS.map(k=>delta[0][k]).join(',')].join('\n');
 assert.equal(parseTrackerDelta(XLSX,new TextEncoder().encode(csv),'delta.csv')[0].lot,'001');
 const tsv=[TRACKER_HEADERS.join('\t'),TRACKER_FIELDS.map(k=>delta[0][k]).join('\t')].join('\n');
 assert.equal(parseTrackerDelta(XLSX,new TextEncoder().encode(tsv),'delta.tsv')[0].order_folder_url,delta[0].order_folder_url);
});
test('reject wrong headers, unexpected columns and formulas without dropping data',()=>{
 assert.throws(()=>parseTrackerDelta(XLSX,workbook(delta,s=>{s.D1.v='Wrong';}),'delta.xlsx'),/headers/);
 assert.throws(()=>parseTrackerDelta(XLSX,workbook(delta,s=>{s.M2={t:'s',v:'extra'};s['!ref']='A1:M12';}),'delta.xlsx'),/Extra/);
 assert.throws(()=>parseTrackerDelta(XLSX,workbook(delta,s=>{s.J2={t:'n',v:2,f:'1+1'};}),'delta.xlsx'),/formulas/);
});
test('append 11 rows, repeat safely, keep baseline values byte-for-byte',()=>{
 const baseline=[row(99)],before=JSON.stringify(baseline);
 const plan=planTrackerAppend(baseline,delta);
 assert.equal(plan.inserted,11);assert.equal(plan.skipped,0);assert.equal(plan.conflicting,0);
 const next=planTrackerAppend([...baseline,...plan.rows],delta);
 assert.equal(next.inserted,0);assert.equal(next.skipped,11);
 assert.equal(JSON.stringify(baseline),before);
});
test('PO and OE pair plus separate lots distinguish legitimate rows; existing values never change',()=>{
 const saved=row(1),plan=planTrackerAppend([saved],[
  {...saved},row(2,{po:saved.po}),row(3,{po:saved.po,oe:saved.oe}),{...saved,sale_price:9999},
  row(5,{po:''}),row(6,{po:saved.po,oe:saved.oe,builder:'Different Builder'})
 ]);
 // Uploaded order disagreements are deliberately all held for review.
 assert.equal(plan.decisions[1].action,'inserted');
 assert.equal(plan.decisions[4].action,'conflicting');
 assert.equal(plan.decisions[5].action,'conflicting');
 const lots=planTrackerAppend([saved],[row(2,{po:saved.po,oe:saved.oe})]);
 assert.equal(lots.inserted,1);
 const changed=planTrackerAppend([saved],[{...saved,sale_price:9999}]);
 assert.equal(changed.conflicting,1);assert.equal(changed.decisions[0].existing.sale_price,1234.56);
 const repeat=planTrackerAppend([saved],[{...saved}]);assert.equal(repeat.skipped,1);
});
test('conflicting duplicates within a file are held together, exact repeats appear once',()=>{
 const a=row(1);
 const p=planTrackerAppend([], [a,{...a,notes:'Different'}]);
 assert.equal(p.conflicting,2);assert.equal(p.inserted,0);
 const q=planTrackerAppend([],[a,{...a}]);assert.equal(q.inserted,1);assert.equal(q.skipped,1);
});
test('concurrent duplicate batches are a set; conflicting batches cannot overwrite baseline',()=>{
 const batch={id:'a',import_key:'file-a',imported_at:'2026-09-10T01:00:00Z',filename:'delta.xlsx',rows:delta};
 const result=applyTrackerAppends([row(99)],[batch,{...batch,id:'b'}, {...batch,id:'c',import_key:'file-c'},
  {...batch,id:'d',import_key:'file-d',rows:[row(99,{notes:'Attempt overwrite'})]}]);
 assert.equal(result.rows.length,12);assert.equal(result.appended.length,11);assert.equal(result.conflicts.length,1);
 assert.equal(result.rows[0].notes,'Captured note');assert.equal(result.appended[0].source_file,'delta.xlsx');
});
function harness({role='admin',uploadFails=false,loseResponse=false}={}) {
 const baseline=[row(99)], batches=[],counts={uploads:0,creates:0};
 const entities=new Proxy({SalesTrackerAppendBatch:{
  filter:async query=>batches.filter(b=>b.import_key===query.import_key),
  create:async data=>{counts.creates++;const saved={...data,id:'batch-'+counts.creates};batches.push(saved);if(loseResponse){loseResponse=false;throw Error('Lost response after save');}return saved;}
 }},{get(target,key){if(key in target)return target[key];throw Error('Existing entities must never be mutated: '+String(key));}});
 const client={auth:{me:async()=>({role,email:'owner@example.com'})},asServiceRole:{entities},
 integrations:{Core:{UploadPrivateFile:async()=>{counts.uploads++;if(uploadFails)throw Error('Upload failed');return {file_uri:'private:delta'};}}}};
 const readView=async()=>({snapshot:{id:'baseline',sha256:'baseline-sha'},...applyTrackerAppends(baseline,batches)});
 const handler=createTrackerAppendHandler({getClient:async()=>client,XLSX,readView,now:()=>new Date('2026-09-10T12:00:00Z')});
 const payload={filename:'delta.xlsx',file_base64:Buffer.from(workbook(delta)).toString('base64'),source_captured_at:'2026-09-10T11:00:00Z'};
 async function call(action,extra={}){const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({...payload,action,...extra})}));return {status:response.status,body:await response.json()};}
 return {baseline,batches,counts,call};
}
test('review writes nothing, commit appends once, replay skips all 11 rows',async()=>{
 const h=harness(),before=JSON.stringify(h.baseline);
 const review=await h.call('review');
 assert.equal(review.status,200);assert.equal(review.body.inserted,11);assert.deepEqual(h.counts,{uploads:0,creates:0});
 const commit=await h.call('append',{review_token:review.body.review_token});
 assert.equal(commit.status,200);assert.equal(commit.body.inserted,11);assert.deepEqual(h.counts,{uploads:1,creates:1});
 const retry=await h.call('append',{review_token:review.body.review_token});
 assert.equal(retry.body.inserted,0);assert.equal(retry.body.skipped,11);assert.equal(h.counts.creates,1);
 assert.equal(JSON.stringify(h.baseline),before);
});
test('a changed tracker invalidates review; unauthorized or replacement calls cannot write',async()=>{
 const h=harness();const review=await h.call('review');h.baseline.push(row(98));
 const stale=await h.call('append',{review_token:review.body.review_token});
 assert.equal(stale.status,409);assert.deepEqual(h.counts,{uploads:0,creates:0});
 assert.equal((await h.call('replace')).status,400);
 const denied=harness({role:'user'});assert.equal((await denied.call('review')).status,403);assert.equal(denied.counts.creates,0);
});
test('upload failure preserves baseline; retry after uncertain save creates no duplicate',async()=>{
 const failed=harness({uploadFails:true}),r=await failed.call('review');
 assert.equal((await failed.call('append',{review_token:r.body.review_token})).status,400);
 assert.equal(failed.counts.creates,0);assert.equal(failed.baseline.length,1);
 const h=harness({loseResponse:true}),review=await h.call('review');
 assert.equal((await h.call('append',{review_token:review.body.review_token})).status,400);
 const retry=await h.call('review');
 assert.equal(retry.body.status,'committed');assert.equal(retry.body.skipped,11);assert.equal(h.counts.creates,1);
});

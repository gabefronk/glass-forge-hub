import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionPatch,latestCompletion,validDay} from '../base44/shared/customerCollections.js';
import {handle} from '../base44/shared/customerCollectionsHandle.js';
import {enqueueCustomerCollection} from '../base44/shared/enqueueCustomerCollection.js';
import {inInvoiceScope} from '../src/lib/invoiceScope.js';
const job='a'.repeat(24), id='b'.repeat(24),note={id:'c'.repeat(24),job_id:job,completion:'complete',note_date:'2026-10-16',created_date:'2026-10-16T20:00:00Z'};
const row={id,job_id:job,fee_type:'profit_split',updated_date:'v1',invoice_month:'2026-09',job_date:'2026-09-30',sale_price:null,cost:null,labor_amt:0};
const context={today:'2026-10-17',now:'2026-10-17T20:00:00Z',userId:'owner',completion:note};
const body=action=>({action,expected_updated_date:'v1'});
test('enrollment keeps amounts, dates and supplier ledgers out of patch',()=>{
 const p=collectionPatch(row,body('enroll'),context);
 assert.equal(p.customer_collection_state,'awaiting_request');
 for(const k of ['sale_price','cost','labor_amt','fee_amt','job_date','invoice_month','paid_to_ya','paid_at','supplier_payment'])assert.equal(k in p,false,k);
});
test('unpaid enrolled item stays out of invoice month; paid same item uses received month',()=>{
 const pending={...row,customer_collection_state:'awaiting_request'};
 assert.equal(inInvoiceScope(pending,'2026-09'),false);
 const p=collectionPatch(pending,{...body('paid'),received_date:'2026-10-17',reference:'Customer check 123'},context);
 assert.equal(p.invoice_month,'2026-10');assert.equal(p.paid_to_ya,true);assert.equal(p.paid_date,'2026-10-17');
 assert.equal(inInvoiceScope({...pending,...p},'2026-10',job),true);assert.equal(p.customer_original_invoice_month,'2026-09');assert.equal('job_date' in p,false);
});
test('receipt requires explicit real non-future date and reference; closed months fail',()=>{
 const r={...row,customer_collection_state:'prepared'};
 for(const received_date of ['2026-02-30','2026-10-18',''])assert.throws(()=>collectionPatch(r,{...body('paid'),received_date,reference:'check'},context));
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2026-10-17'),true);
 assert.throws(()=>collectionPatch(r,{...body('paid'),received_date:'2026-10-17',reference:'check'},{...context,closedMonths:['2026-10']}),/closed/);
 assert.throws(()=>collectionPatch(r,{...body('paid'),received_date:'2026-10-17',reference:''},context),/reference/);
});
test('prepare never marks requested, billed or paid and cannot send to QuickBooks',()=>{
 const p=collectionPatch({...row,customer_collection_state:'awaiting_request'},body('prepare'),context);
 assert.equal(p.customer_collection_state,'prepared');assert.equal('paid_to_ya' in p,false);assert.equal('billed_to_bfs' in p,false);
});
test('stale, billed, duplicate enrollment and incomplete work block',()=>{
 assert.throws(()=>collectionPatch(row,{...body('enroll'),expected_updated_date:'stale'},context),/changed/);
 assert.throws(()=>collectionPatch({...row,invoiced_to_ya:true},body('enroll'),context),/billed/);
 assert.throws(()=>collectionPatch({...row,paid_to_ya:true},body('enroll'),context),/existing/);
 assert.throws(()=>collectionPatch(row,body('enroll'),{...context,completion:{...note,completion:'incomplete'}}),/complete/);
 assert.equal(latestCompletion([note,{...note,id:'new',created_date:'2026-10-17',completion:'incomplete'}]).completion,'incomplete');
});
test('owner auth runs before reads and rejects price fields',async()=>{
 let reads=0;
 const req=b=>({json:async()=>b});
 const a={authMe:async()=>({id:'someone'}),lineGet:async()=>{reads++;}};
 assert.equal((await handle(req({action:'paid'}),a)).status,403);assert.equal(reads,0);
 a.authMe=async()=>({id:'6a7f0d834a5f825c724273ea'});
 assert.equal((await handle(req({action:'paid',sale_price:900}),a)).status,400);assert.equal(reads,0);
});
test('new report enqueue is idempotent and never sweeps existing jobs or edits money',async()=>{
 let saved={...row},writes=0;
 const api={MonthCloseSnapshot:{filter:async()=>[]},Jobs:{get:async()=>({id:job})},FeeLines:{filter:async()=>[saved],get:async()=>saved,update:async(_,p)=>{writes++;assert.equal('sale_price'in p,false);saved={...saved,...p};}}};
 assert.equal((await enqueueCustomerCollection(api,{jobId:job,note,now:context.now})).state,'awaiting_request');
 await enqueueCustomerCollection(api,{jobId:job,note,now:context.now});assert.equal(writes,1);
});

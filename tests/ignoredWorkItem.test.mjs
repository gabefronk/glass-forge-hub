import test from 'node:test';
import assert from 'node:assert/strict';
import {isIgnoredWorkItem} from '../base44/shared/billingCore.js';
import {withComputedAmounts} from '../src/lib/feeMath.js';
import {withCompanions} from '../src/lib/invoicingFilters.js';
import {filterOwnedCalendar} from '../base44/functions/ownedCalendar/engine.js';
test('Renta reminder matches source, job and fee names without suppressing real rental jobs',()=>{
 for(const name of ['Renta',' RENTA ','renta.','Renta!']) {
  assert.equal(isIgnoredWorkItem(name),true);
  for(const field of ['canonical_name','job_name_raw','job_name','summary','job_name_norm'])assert.equal(isIgnoredWorkItem({[field]:name}),true);
 }
 for(const name of ['Rental','Renta Homes','Window rental install','Renta - window installation','',null])assert.equal(isIgnoredWorkItem(name),false);
});
test('existing reminders disappear from billing without changing saved rows or real work',()=>{
 const reminder={id:'r',job_name_raw:'Renta',calendar_labor_amt:100,fee_pct:0.1};
 const work={id:'w',job_name_raw:'Rental window install',calendar_labor_amt:200,fee_pct:0.1};
 const rows=[reminder,work],before=structuredClone(rows);
 assert.deepEqual(withComputedAmounts(rows).map(r=>r.id),['w']);
 assert.equal(withComputedAmounts(rows)[0].fee_amt,20);
 assert.deepEqual(withCompanions(rows,[]).map(r=>r.id),['w']);
 assert.deepEqual(rows,before);
});
test('ignored calendar entries create neither visits nor unmatched review items',()=>{
 const events=[{id:'r',job_name:'Renta',event_date:'2026-10-04'},{id:'w',job_name:'Rental window install',event_date:'2026-10-04'}];
 const before=structuredClone(events),result=filterOwnedCalendar(events,[]);
 assert.deepEqual(result.groups.flat().map(e=>e.id),['w']);
 assert.equal(result.counts.source_events,1);
 assert.equal(result.counts.unmatched_events,1);
 assert.deepEqual(events,before);
});

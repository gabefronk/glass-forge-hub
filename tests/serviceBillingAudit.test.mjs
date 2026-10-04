import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLaborAmount,computeLaborAmt,computeFeeAmt} from '../base44/shared/billingCore.js';
import {assessBillingLine,withBillingAudit} from '../base44/shared/billingAudit.js';
import {withCompanions,isReady,isReportBlocked} from '../src/lib/invoicingFilters.js';
const day='2026-10-04';
const fee={id:'c',job_date:'2026-09-28',source:'calendar',calendar_event_id:'e',billable:true,fee_pct:.1};
test('installer authorization survives customer no-charge without reading previous ticket amounts',()=>{
 assert.equal(extractLaborAmount('NO CHARGE PER OSR. We can pay him $350, no charge to customer.\n____________\nLabor $900'),350);
 assert.equal(extractLaborAmount('No current labor\n____________\nLabor $900'),null);
 assert.equal(extractLaborAmount('Do not pay him $350'),null);
 assert.equal(extractLaborAmount('Pay Israel $350. Labor $400'),null);
 assert.equal(extractLaborAmount('VPO required for $911.28 | quote 3517242'),null);
 assert.equal(extractLaborAmount('Labor$-1400--win'),1400);
 assert.equal(extractLaborAmount('Labor $-1400'),null);
 const r={...fee,calendar_labor_amt:350,calendar_note_text:'We can pay him $350, no charge to customer.'};
 assert.equal(computeLaborAmt(r),350);assert.equal(computeFeeAmt(r),35);
 assert.equal(assessBillingLine(r,{report_status:'ok'},day).customer_no_charge,true);
});
test('service quantities are missing until explicitly supplied; headcount is not hours',()=>{
 const event={scope_notes:'Chargeable per OSR. Replace glass. Requires 2-3 people. VPO $911.28',report_status:'ok'};
 const a=assessBillingLine(fee,event,day);assert.equal(a.kind,'review');assert.match(a.reason,/Israel/);
 assert.equal(assessBillingLine({...fee,calendar_labor_amt:350},event,day).kind,'standard');
});
test('included work remains separate from chargeable installer compensation',()=>{
 assert.equal(assessBillingLine(fee,{scope_notes:'Please install sheetrock windows.',report_status:'ok'},day).kind,'no_charge');
 assert.equal(assessBillingLine(fee,{scope_notes:'No charge per Gabe. Replace screen.'},day).kind,'no_charge');
 assert.equal(assessBillingLine(fee,{scope_notes:'No pay on this one - good favor.'},day).kind,'no_charge');
 assert.equal(assessBillingLine({...fee,probuild_note_text:'Checked windows, no charge'},{scope_notes:'Check window operations'},day).kind,'no_charge');
 assert.equal(assessBillingLine({...fee,man_hours:2},{scope_notes:'No charge per Gabe. Replace screen.'},day).kind,'review');
 assert.equal(assessBillingLine(fee,{scope_notes:'Warranty. Replace glass.',report_status:'ok'},day).kind,'review');
});
test('future, rescheduled, cancelled and tracker-only work cannot become earned just from a past fee date',()=>{
 assert.equal(assessBillingLine(fee,{event_date:'2026-10-05'},day).kind,'scheduled');
 assert.equal(assessBillingLine(fee,{source_status:'cancelled'},day).kind,'scheduled');
 assert.equal(assessBillingLine({...fee,probuild_post_id:'p'},{source_status:'cancelled'},day).kind,'review');
 assert.equal(assessBillingLine(fee,{scope_notes:'Sales Tracker DAILY SALES row 2532\nSale: $3,608.49',report_status:'ok'},day).kind,'tracker_only');
 assert.equal(assessBillingLine({...fee,job_name_raw:'YA - THOMAS - Pick Up'},{scope_notes:'Pella del to BFS –9/3 QTY.13',report_status:'ok'},day).kind,'logistics');
 assert.equal(assessBillingLine({...fee,manually_adjusted:true},null,day).kind,'preserved');
});
test('job name alone does not move charges; report identity supplies context and folds the zero twin once',()=>{
 const event={google_event_id:'e',event_date:'2026-09-28',scope_notes:'We can pay him $350, no charge to customer.',matched_post_ids:['p'],report_status:'ok'};
 const rows=[{...fee,calendar_labor_amt:350,labor_amt:350},{...fee,id:'p',source:'probuild',calendar_event_id:null,probuild_post_id:'p',note_text:'Removed lock',labor_amt:0}];
 const before=structuredClone(rows),out=withCompanions(rows,[event]);
 assert.equal(out.find(r=>r.id==='p')._companion_folded,true);
 assert.equal(out.find(r=>r.id==='c')._customer_no_charge,true);
 assert.deepEqual(rows,before);
 assert.equal(withBillingAudit([{...fee,calendar_event_id:null,job_name_raw:'same name'}],[event],day)[0]._customer_no_charge,false);
});
test('orders, source outages and reschedules are not completion evidence',()=>{
 const row={...fee,calendar_labor_amt:1000,labor_amt:1000,calendar_note_text:'Amsco direct QTY.12 OE 12345678 Labor $1000'};
 assert.equal(isReportBlocked(row,new Map([['e','missing_all']])),true);
 assert.equal(isReportBlocked(row,new Map([['e','no_source_data']])),true);
 assert.equal(isReportBlocked(row,new Map()),true);
 assert.equal(isReportBlocked({...row,probuild_post_id:'p',probuild_note_text:'Installed'},new Map([['e','rescheduled']])),true);
 assert.equal(isReady({...row,_billing_review:'Date conflict'},new Map([['e','ok']]),new Set()),false);
 assert.equal(isReady(row,new Map([['e','ok']]),new Set()),true);
});

import './support/register-src-alias.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
const {jobsStatus}=await import('../src/lib/jobsSanitize.js');
const {buildReportEvidence}=await import('../src/lib/jobReports.js');
const {invoicingStats}=await import('../src/lib/invoicingStats.js');
test('explicit work complete overrides zero labor without modifying billing; later incomplete and future visit do not',()=>{
 const rows=[{job_id:'j',labor_amt:0,source:'calendar',job_date:'2026-09-30'}];
 const note={job_id:'j',completion:'complete',created_date:'2026-10-16'};
 assert.equal(jobsStatus(rows,buildReportEvidence({notes:[note]}),'2026-10-17').key,'complete');
 assert.equal(jobsStatus(rows,buildReportEvidence({notes:[note,{...note,completion:'incomplete',created_date:'2026-10-17'}]}),'2026-10-17').key,'active');
 assert.notEqual(jobsStatus([...rows,{...rows[0],job_date:'2026-10-20'}],buildReportEvidence({notes:[note]}),'2026-10-17').key,'complete');
 assert.equal(rows[0].labor_amt,0);
});
test('pending customer collections do not count as ready or earned; paid missing costs remain held',()=>{
 const r={id:'r',billable:true,job_date:'2026-09-30',fee_type:'profit_split',split_pct:.5,sale_price:900,cost:400,customer_collection_state:'awaiting_request'};
 assert.equal(invoicingStats([r],new Map()).monthEarnedTotal,0);
 const missing={...r,customer_collection_state:'paid',sale_price:null,cost:null};
 const s=invoicingStats([missing],new Map());assert.equal(s.readyCount,0);assert.equal(s.matchBlockedCount,1);assert.equal(s.monthEarnedTotal,0);
 assert.equal(invoicingStats([{...r,customer_collection_state:'paid'}],new Map()).readyTotal,250);
});

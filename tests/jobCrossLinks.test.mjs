import test from 'node:test';
import assert from 'node:assert/strict';
import {matchExactJob,ownerConfirmedJobPatch} from '../base44/shared/jobLinking.js';

const jobs = [
  {id:'job-101',canonical_name:'Acme - Pine Lot 12',aliases:['Pine 12'],builder:'Acme',source_window_quote_id:'quote-1'},
  {id:'job-102',canonical_name:'Acme - Pine Lot 12',aliases:['Pine 12'],builder:'Acme'},
  {id:'job-103',canonical_name:'Acme - Pine Lot 13',builder:'Acme'},
];

test('exact job matching never auto-links an ambiguous name',()=>{
  const match=matchExactJob({job_name:'Pine 12',builder:'Acme'},jobs);
  assert.equal(match.status,'needs_review');
  assert.deepEqual(match.candidate_job_ids,['job-101','job-102']);
  assert.equal(match.job_id,undefined);
});

test('quote reference links only its single exact permanent job id',()=>{
  assert.deepEqual(matchExactJob({quote_id:'quote-1'},jobs),{
    status:'matched',job_id:'job-101',candidate_job_ids:['job-101'],evidence:['quote quote-1'],
  });
});

test('missing or unmatched identity remains unlinked for review',()=>{
  for(const input of [{}, {job_name:'Pine Lot 99',builder:'Acme'}]){
    const match=matchExactJob(input,jobs);
    assert.equal(match.status,'needs_review');
    assert.deepEqual(match.candidate_job_ids,[]);
  }
});

test('owner confirmation records the chosen permanent id without changing money data',()=>{
  const budget={status:'needs_review',computed:{actual_total_sell:1234},job_match:{reason:'two candidates'}};
  const patch=ownerConfirmedJobPatch(budget,jobs[1],'2026-09-25T12:00:00.000Z');
  assert.equal(patch.job_id,'job-102');
  assert.equal(patch.job_match.status,'owner_confirmed');
  assert.equal(patch.status,'draft');
  assert.equal(patch.computed,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrustedSourceLinks } from '../shared/trustedSourceLinks.mjs';
const jobs = [{ id:'j16', canonical_name:'Acme - 16 Pine Grove' }, { id:'duplicate16', canonical_name:'Acme - 16 Pine Grove' }, { id:'j17', canonical_name:'Acme - 17 Pine Grove' }];
const fee = patch => ({ id:'f1',job_id:'j16',job_name_raw:'Acme - 16 Pine Grove',match_confidence:'high',probuild_project_id:'p16',probuild_post_id:'post1',calendar_event_id:'event1',...patch });
const project = patch => ({ source_project_id:'p16',name:'Acme - 16 Pine Grove',source_deleted:false,...patch });
const build = patch => buildTrustedSourceLinks({jobs,fees:[fee()],projects:[project()],...patch});

test('verified fee chooses its explicit Job among duplicate canonical names without merging',()=>{
  const input={jobs:structuredClone(jobs),fees:[fee()],projects:[project()]};const before=JSON.stringify(input);
  const result=buildTrustedSourceLinks(input);assert.equal(result.project_links[0].job_id,'j16');assert.equal(result.post_job('post1'),'j16');assert.equal(result.calendar_job('event1'),'j16');assert.equal(JSON.stringify(input),before);
});
test('pricing review does not erase otherwise verified identity or clear that review',()=>{
  const result=build({fees:[fee({needs_review:true,pricing_review_reason:'Service quantity missing'})]});assert.equal(result.project_links[0].job_id,'j16');assert.equal(result.project_links[0].billing_review_present,true);
});
test('missing or unmatched identity confidence is not accepted',()=>{
  for(const confidence of [undefined,'unmatched','low','medium']){const result=build({fees:[fee({match_confidence:confidence})]});assert.equal(result.project_links.length,0);assert.equal(result.post_job('post1'),null);}
});
test('conflicting high-confidence fee is not discarded to manufacture a unique project',()=>{
  const result=build({fees:[fee(),fee({id:'f2',job_name_raw:'Acme - 17 Pine Grove',probuild_post_id:'post2'})]});assert.equal(result.project_links.length,0);assert.equal(result.post_job('post2'),null);assert.ok(result.diagnostics.some(x=>x.reason==='conflicting_fee_identity'));
});
test('source associated to two canonical Job IDs remains ambiguous',()=>{
  const result=build({fees:[fee(),fee({id:'f2',job_id:'duplicate16'})]});assert.equal(result.project_links.length,0);assert.equal(result.post_job('post1'),null);assert.equal(result.calendar_job('event1'),null);
});
test('different active lower-confidence Job blocks rather than resolving the high candidate arbitrarily',()=>{
  const result=build({fees:[fee(),fee({id:'f2',job_id:'duplicate16',match_confidence:'unmatched'})]});assert.equal(result.project_links.length,0);
});
test('superseded association does not defeat active source identity',()=>{
  const result=build({fees:[fee(),fee({id:'f2',job_id:'duplicate16',superseded_by:'f1'})]});assert.equal(result.project_links[0].job_id,'j16');
});
test('existing project link conflict prevents inferred crosswalk',()=>{
  const result=build({links:[{project_id:'p16',job_id:'duplicate16'}]});assert.equal(result.project_links.length,0);assert.ok(result.diagnostics.some(x=>x.reason==='existing_project_link_conflict'));
});
test('missing or deleted project metadata is not promoted',()=>{
  assert.equal(build({projects:[]}).project_links.length,0);assert.equal(build({projects:[project({source_deleted:true})]}).project_links.length,0);
});
test('multi-lot project retains scope and receives no blanket crosswalk',()=>{
  for(const name of ['Acme - 16-17 Pine Grove','Acme - lots 16 and 17 Pine Grove','Acme - Bldg 4 Pine Grove 16/17']){
    const result=build({jobs:[{id:'j16',canonical_name:name}],fees:[fee({job_name_raw:name})],projects:[project({name})]});assert.equal(result.project_links.length,0);
  }
});
test('unknown raw name with conflicting numeric identity is rejected',()=>{
  const result=build({fees:[fee({job_name_raw:'Install visit Pine Grove 88'})]});assert.equal(result.project_links.length,0);assert.equal(result.post_job('post1'),null);
});
test('valid same-number label variation supports post identity but project still requires exact catalog name',()=>{
  const result=build({fees:[fee({job_name_raw:'Install Acme Pine Grove 16'})],projects:[project({name:'Other Builder 16'})]});assert.equal(result.post_job('post1'),'j16');assert.equal(result.project_links.length,0);
});
test('absent fee label is not an identity assertion',()=>{
  const result=build({fees:[fee({job_name_raw:''})]});assert.equal(result.post_job('post1'),null);
});
test('matching numeric lot without matching builder and subdivision cannot bind a post',()=>{
  const result=build({fees:[fee({job_name_raw:'Other Builder Other Place 16'})]});assert.equal(result.post_job('post1'),null);assert.equal(result.project_links.length,0);
});

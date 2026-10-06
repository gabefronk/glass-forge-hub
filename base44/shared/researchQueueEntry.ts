import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {createResearchQueueHandler} from './researchQueueHandler.mjs';
import {makeResearchPacket,canaryPacket} from './researchQueuePacket.mjs';
import {allKnowledgeRows,readPreparedJob} from './jobKnowledgeService.mjs';
import {resolvePreparedJobQuery,buildPreparedJobLookup} from './preparedJobLookup.mjs';
import {buildJobResearchPlan} from './jobResearchPlan.mjs';
import {fail} from './researchQueueCore.mjs';
import {makeFinderLoader,runQuickSearch,moveVisitThroughHub} from './researchQuickSearch.js';
async function makePacket({client,input,now}){
  if(input.action==='enqueue_canary')return canaryPacket();
  const api=client.asServiceRole,query=input.query||{};
  const jobs=await allKnowledgeRows(api.entities.Jobs,['id','canonical_name','aliases','builder','po_numbers','oe_numbers','address']);
  const projectLinks=query.project_id?await allKnowledgeRows(api.entities.ProbuildProjectLink,['project_id','job_id']):[];
  const identity=resolvePreparedJobQuery({query,jobs,projectLinks,catalogComplete:true});
  if(identity.status!=='matched')fail(400,'Resolve one exact job; provisional or conflicting identities stay with the owner.');
  const prepared=await readPreparedJob(api,identity.job_id,now);
  const lookup=buildPreparedJobLookup({query,jobs,projectLinks,prepared,now});
  const plan=buildJobResearchPlan({query,lookup:{...lookup,job_name:jobs.find(j=>j.id===identity.job_id)?.canonical_name},research:input.research||{},now});
  return makeResearchPacket(plan);
}
// Fast path: rows are read with the service role (crew logins get addresses without
// seeing money-bearing rows); the output is money-free by construction.
const loadFinder=makeFinderLoader();
async function quickSearch({client,input,now}){
  const {jobs,events}=await loadFinder(client.asServiceRole.entities,input.fresh===true);
  return runQuickSearch({input,jobs,events,now});
}
async function moveVisit({client,input}){
  const out=await moveVisitThroughHub({client,input});
  if(out.body?.ok)loadFinder.invalidate();
  return out;
}
Deno.serve(createResearchQueueHandler({getClient:async req=>createClientFromRequest(req),makePacket,quickSearch,moveVisit}));

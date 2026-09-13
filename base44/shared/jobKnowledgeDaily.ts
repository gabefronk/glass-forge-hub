import {refreshJobKnowledge} from './jobKnowledgeService.mjs';
import {readKnowledgeTracker} from './jobKnowledgeRuntime.ts';
import {readJobKnowledgeProviders} from './jobKnowledgeProviders.ts';
import {extractJobDocuments} from './jobDocumentExtraction.mjs';

// Reuses the existing Daily Agent Runs schedule and its configured pause switch.
// This does not introduce a second scheduler or an outbound message sender.
export async function prepareDailyKnowledge(base44,{triggeredBy,onlyLeadId}={}) {
  if(onlyLeadId)return {status:'single_lead_run'};
  const api=base44.asServiceRole;
  const config=(await api.entities.AgentOpsConfig.filter({config_key:'autonomous_ops'},'-updated_date',1))[0];
  if(!config?.autonomous_enabled||config.paused&&triggeredBy==='scheduler')return {status:'paused'};
  try {
    const documents=await extractJobDocuments(api,{maxFiles:2}).catch(()=>({status:'failed',error:'Private document extraction could not complete.'}));
    const prepared=await refreshJobKnowledge({api,readTracker:readKnowledgeTracker,readProviders:()=>readJobKnowledgeProviders(base44)});
    return {...prepared,documents};
  } catch {
    const key='job_knowledge:preparation_failed';
    const old=(await api.entities.AgentCenterEscalation.filter({escalation_key:key},'-created_date',1))[0];
    const row={escalation_key:key,agent_id:'development_lead',department:'Job information',title:'Daily job preparation failed',context:'The new job brief could not finish. The previous complete generation remains available; check its date before replying.',status:'needs_owner_decision',created_at:old?.created_at||new Date().toISOString()};
    if(old)await api.entities.AgentCenterEscalation.update(old.id,row);else await api.entities.AgentCenterEscalation.create(row);
    return {status:'failed',automatic_send_allowed:false};
  }
}

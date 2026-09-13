// Research queue 20260913 v1 — supplied-context review only. No messages, source mutation, or external retrieval.
// Handler logic lives in base44/shared/researchQueueHandler.mjs; packet building in researchQueuePacket.mjs.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { createResearchQueueHandler } from '../../shared/researchQueueHandler.mjs';
import { makeResearchPacket, canaryPacket } from '../../shared/researchQueuePacket.mjs';
import { allKnowledgeRows, readPreparedJob } from '../../shared/jobKnowledgeService.mjs';
import { resolvePreparedJobQuery, buildPreparedJobLookup } from '../../shared/preparedJobLookup.mjs';
import { buildJobResearchPlan } from '../../shared/jobResearchPlan.mjs';
import { fail } from '../../shared/researchQueueCore.mjs';

async function makePacket({ client, input, now }) {
  if (input.action === 'enqueue_canary') return canaryPacket();
  const api = client.asServiceRole, query = input.query || {};
  const jobs = await allKnowledgeRows(api.entities.Jobs, ['id', 'canonical_name', 'aliases', 'builder', 'po_numbers', 'oe_numbers', 'address']);
  const projectLinks = query.project_id ? await allKnowledgeRows(api.entities.ProbuildProjectLink, ['project_id', 'job_id']) : [];
  const identity = resolvePreparedJobQuery({ query, jobs, projectLinks, catalogComplete: true });
  if (identity.status !== 'matched') fail(400, 'Resolve one exact job; provisional or conflicting identities stay with the owner.');
  const prepared = await readPreparedJob(api, identity.job_id, now);
  const lookup = buildPreparedJobLookup({ query, jobs, projectLinks, prepared, now });
  const plan = buildJobResearchPlan({ query, lookup: { ...lookup, job_name: jobs.find(j => j.id === identity.job_id)?.canonical_name }, research: input.research || {}, now });
  return makeResearchPacket(plan);
}

const handler = createResearchQueueHandler({ getClient: async req => createClientFromRequest(req), makePacket });

export default async function (req) {
  return handler(req);
}
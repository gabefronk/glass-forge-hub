import { createJobIndex, matchJobEvidence } from './jobContextCore.mjs';

const text = value => typeof value === 'string' ? value.trim() : '';
const norm = value => text(value).normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ');
const unique = values => [...new Set(values)];
const list = value => Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : [];
const numericTokens = value => unique(norm(value).match(/\b[a-z]?\d+[a-z]?\b/g) || []).sort().join('|');
const multipleLots = value => /\b\d+[a-z]?\s*(?:-|\/|,|&|and|through|to)\s*\d+[a-z]?\b/i.test(norm(value)) || [...norm(value).matchAll(/\blot\s*#?\s*[a-z]?\d+[a-z]?\b/g)].length > 1;
const identityNames = job => [job.canonical_name || job.job_name || job.name, ...list(job.aliases)].map(norm).filter(Boolean);
const identityWords = value => norm(value).replace(/^(?:i|s)\s*-\s*|^(?:installation|install|service)\s+(?:-\s*)?/,'').match(/[a-z0-9]+/g)?.sort().join('|') || '';

/** Evidence-local crosswalk only. No source writes, Job merges, fuzzy ranking, or billing decisions. */
export function buildTrustedSourceLinks({ jobs = [], fees = [], projects = [], links = [] } = {}) {
  const catalog = createJobIndex({ jobs });
  const jobsById = new Map(jobs.map(job => [job.id || job.job_id, job]));
  const diagnostics = [];
  const checked = fees.filter(fee => !fee.superseded_by).map(fee => {
    const jobId = text(fee.job_id), label = text(fee.job_name_raw || fee.job_name_norm);
    let reason = null;
    if (fee.match_confidence !== 'high') reason = 'identity_confidence_not_high';
    else if (!catalog.byId.has(jobId)) reason = 'unknown_fee_job_id';
    else if (!label) reason = 'fee_identity_name_missing';
    else {
      const match = matchJobEvidence({ job_id: jobId, job_name: label }, catalog);
      if (match.status !== 'matched') reason = match.reason;
      else if (!identityNames(jobsById.get(jobId)).some(name => numericTokens(name) === numericTokens(label))) reason = 'fee_identity_numbers_disagree';
      else if (!identityNames(jobsById.get(jobId)).some(name => identityWords(name) === identityWords(label))) reason = 'fee_identity_name_disagrees';
    }
    return { fee, jobId, reason };
  });

  function sourceGroups(key) {
    const groups = new Map();
    for (const row of checked) {
      const sourceId = text(row.fee[key]);
      if (!sourceId) continue;
      if (!groups.has(sourceId)) groups.set(sourceId, []);
      groups.get(sourceId).push(row);
    }
    return groups;
  }
  function resolve(group, sourceType, sourceId) {
    // Rejected high-confidence records remain blockers instead of being silently
    // discarded to manufacture a unique association from the remaining rows.
    const high = group.filter(row => row.fee.match_confidence === 'high');
    if (!high.length) return null;
    const invalid = high.filter(row => row.reason);
    const ids = unique(group.map(row => row.jobId).filter(Boolean));
    if (invalid.length || ids.length !== 1) {
      diagnostics.push({ source_type: sourceType, source_id: sourceId, reason: invalid.length ? 'conflicting_fee_identity' : 'multiple_fee_jobs', candidate_job_ids: ids, fee_ids: high.map(row => row.fee.id), details: unique(invalid.map(row => row.reason)) });
      return null;
    }
    return { job_id: ids[0], fee_ids: high.map(row => row.fee.id), billing_review_present: high.some(row => row.fee.needs_review === true) };
  }
  function sourceMap(key, sourceType) {
    const map = new Map();
    for (const [sourceId, group] of sourceGroups(key)) {
      const resolved = resolve(group, sourceType, sourceId);
      if (resolved) map.set(sourceId, resolved);
    }
    return map;
  }
  const calendar = sourceMap('calendar_event_id', 'calendar_event');
  const posts = sourceMap('probuild_post_id', 'probuild_post');
  const projectGroups = sourceGroups('probuild_project_id');
  const projectsById = new Map();
  for (const project of projects) {
    const projectId = text(project.source_project_id);
    if (!projectsById.has(projectId)) projectsById.set(projectId, []);
    projectsById.get(projectId).push(project);
  }
  const existing = new Map();
  for (const link of [...links, ...projects.map(project => ({ project_id: project.source_project_id, job_id: project.job_id, source_deleted: project.source_deleted }))]) {
    if (link.source_deleted || link.enabled === false || !text(link.project_id) || !text(link.job_id)) continue;
    if (!existing.has(link.project_id)) existing.set(link.project_id, new Set());
    existing.get(link.project_id).add(link.job_id);
  }
  const projectLinks = [];
  for (const [projectId, group] of projectGroups) {
    const resolved = resolve(group, 'probuild_project', projectId);
    if (!resolved) continue;
    const records = projectsById.get(projectId) || [];
    let reason = null;
    if (!records.length) reason = 'project_metadata_missing';
    else if (records.some(project => project.source_deleted)) reason = 'source_project_deleted';
    else if (records.some(project => multipleLots(project.name))) reason = 'multi_lot_project_scope';
    else if (records.some(project => !identityNames(jobsById.get(resolved.job_id)).includes(norm(project.name)))) reason = 'project_name_not_exact_for_fee_job';
    else if (existing.has(projectId) && (existing.get(projectId).size !== 1 || !existing.get(projectId).has(resolved.job_id))) reason = 'existing_project_link_conflict';
    if (reason) {
      diagnostics.push({ source_type: 'probuild_project', source_id: projectId, reason, candidate_job_ids: unique([resolved.job_id, ...(existing.get(projectId) || [])]), fee_ids: resolved.fee_ids });
      continue;
    }
    // Preserve original Jobs and source links. The adapter uses this association
    // only when building a generated context and records the supporting fee IDs.
    projectLinks.push({ project_id: projectId, job_id: resolved.job_id, evidence_type: 'validated_fee_project_identity', fee_ids: resolved.fee_ids, billing_review_present: resolved.billing_review_present });
  }
  return {
    project_links: projectLinks,
    calendar_job: id => calendar.get(text(id))?.job_id || null,
    post_job: id => posts.get(text(id))?.job_id || null,
    calendar_links: [...calendar].map(([source_id, value]) => ({ source_id, ...value })),
    post_links: [...posts].map(([source_id, value]) => ({ source_id, ...value })),
    diagnostics,
    counts: { active_fees: checked.length, accepted_high_identity: checked.filter(row => !row.reason).length, rejected_high_identity: checked.filter(row => row.fee.match_confidence === 'high' && row.reason).length, project_links: projectLinks.length, calendar_links: calendar.size, post_links: posts.size },
  };
}

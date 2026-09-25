// Conservative identity resolver shared by report/calendar ingestion and repair.
// Hard identifiers win; names only link when the exact normalized name/alias is unique.
export function normalizeJobLinkValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const exactId = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function resolveJobLink(row, jobs, projectLinks = []) {
  if (row?.job_id) return { job_id: row.job_id, source: row.job_link_source || null, unchanged: true };
  if (row?.project_id) {
    const ids = [...new Set(projectLinks.filter((l) => String(l.project_id) === String(row.project_id) && l.job_id).map((l) => l.job_id))];
    if (ids.length === 1 && jobs.some((j) => j.id === ids[0])) return { job_id: ids[0], source: 'probuild_project' };
  }
  for (const [field, jobField] of [['po_number', 'po_numbers'], ['oe_number', 'oe_numbers']]) {
    const needle = exactId(row?.[field]);
    if (!needle) continue;
    const candidates = jobs.filter((j) => (j[jobField] || []).some((v) => exactId(v) === needle));
    if (candidates.length === 1) return { job_id: candidates[0].id, source: 'po_oe' };
    if (candidates.length > 1) return { job_id: '', source: null, ambiguous: true };
  }
  const name = normalizeJobLinkValue(row?.job_name);
  if (!name) return { job_id: '', source: null };
  const candidates = jobs.filter((j) => [j.canonical_name, ...(j.aliases || [])].some((v) => normalizeJobLinkValue(v) === name));
  return candidates.length === 1
    ? { job_id: candidates[0].id, source: 'name_exact' }
    : { job_id: '', source: null, ambiguous: candidates.length > 1 };
}

export function suggestJobLinks(row, jobs, limit = 3) {
  const name = normalizeJobLinkValue(row?.job_name);
  const words = new Set(name.split(' ').filter(Boolean));
  return jobs.map((job) => {
    const labels = [job.canonical_name, ...(job.aliases || [])].filter(Boolean);
    const normalized = labels.map(normalizeJobLinkValue);
    const reasons = [];
    let score = 0;
    for (const [field, values, label] of [['po_number', job.po_numbers, 'PO'], ['oe_number', job.oe_numbers, 'OE']]) {
      const needle = exactId(row?.[field]);
      if (needle && (values || []).some((v) => exactId(v) === needle)) { score += 100; reasons.push(`${label} exact`); }
    }
    if (name && normalized.includes(name)) { score += 80; reasons.push('name/alias exact'); }
    else if (words.size) {
      const overlap = Math.max(0, ...normalized.map((v) => [...words].filter((w) => v.split(' ').includes(w)).length / words.size));
      if (overlap) { score += overlap * 20; reasons.push('name words'); }
    }
    return { job_id: job.id, job_name: job.canonical_name, reasons, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || String(a.job_name).localeCompare(String(b.job_name))).slice(0, limit);
}

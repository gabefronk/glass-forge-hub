import { HttpError, sha256 } from './windowQuotesCore.js';
import { configurationInputSnapshot } from './nativeConfigurationResult.js';

const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const fail = (status, message) => { throw new HttpError(status, message); };
const canonical = rows => [...rows].sort((a, b) => String(a.created_date || a.created_at || '').localeCompare(String(b.created_date || b.created_at || '')) || a.id.localeCompare(b.id))[0];

export async function onlinePackageIsCurrent(db, child, hash = sha256, policy) {
  if (!id(child?.package_id) || !id(child.parent_quote_id)) return false;
  const [works, quotes] = await Promise.all([
    db.WindowQuoteConfigurationPackages.filter({ id: child.package_id }, undefined, 1),
    db.QuoteRequests.filter({ id: child.parent_quote_id }, undefined, 1)
  ]);
  const work = works[0], q = quotes[0];
  if (policy !== undefined && stable(work?.policy) !== stable(policy)) return false;
  if (!work || !q || !['preparing', 'pending'].includes(work.status) || q.worker_status !== 'queued' || q.pricing_progress?.package_id !== work.id ||
      work.quote_id !== q.id || work.input_revision !== q.input_revision || work.owner_email !== q.requester_email ||
      child.package_input_hash !== work.input_hash || child.requester_email !== work.owner_email || child.input_revision !== 1) return false;
  if (await hash(stable({ input: configurationInputSnapshot(q), source: q.source })) !== work.input_hash) return false;
  const index = child.source_index;
  if (!Number.isInteger(index) || index < 0 || index >= q.lines.length ||
      (Array.isArray(work.items) && work.items[index]?.state === 'priced') || child.lines?.length !== 1 ||
      stable(child.lines[0]) !== stable(q.lines[index]) || stable(child.settings) !== stable(q.settings)) return false;
  return await hash(stable({ package_id: work.id, input_hash: work.input_hash, index, settings: q.settings, line: q.lines[index] })) === child.selection_hash;
}

// The existing guarded online executor can work against this private collection
// without adding its technical child requests to the customer's request list.
// Its shared browser lock and operation/checkpoint fences remain unchanged.
export function privateOnlineDatabase(db, { hash = sha256, policy } = {}) {
  const rows = db.WindowQuoteOnlineRequests;
  const privateRows = new Proxy(rows, {
    get(target, name) {
      if (name === 'filter') return async (query, sort, limit) => {
        if (query?.worker_status !== 'queued') return target.filter(query, sort, limit);
        const selected = [], skipped = [], wanted = limit || 100, batchSize = Math.max(50, wanted);
        // Old private requests must not hide an eligible window behind a fixed
        // first-page limit. Exclusions also preserve ordering across equal dates.
        while (selected.length < wanted) {
          const found = await target.filter({ ...query, ...(skipped.length ? { id: { $nin: skipped } } : {}) }, sort, batchSize);
          if (!found.length) break;
          const valid = await Promise.all(found.map(row => onlinePackageIsCurrent(db, row, hash, policy)));
          selected.push(...found.filter((_row, index) => valid[index]));
          skipped.push(...found.map(row => row.id));
          if (found.length < batchSize || query.id !== undefined) break;
        }
        return selected.slice(0, wanted);
      };
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return new Proxy(db, { get(target, name) { return name === 'QuoteRequests' ? privateRows : Reflect.get(target, name); } });
}

export function createConfigurationOnlineService({ execution, verifyReady, now = () => new Date(), hash = sha256, policy } = {}) {
  const configured = execution?.configured === true && typeof verifyReady === 'function';
  const digest = value => hash(stable(value));

  async function progress({ db, work, indices, settings, lines, allowDispatch = true }) {
    if (!configured) return { status: 'failed', questions: ['AMSCO online pricing is unavailable.'] };
    if (typeof allowDispatch !== 'boolean' || !id(work?.id) || !id(work.quote_id) || !Array.isArray(indices) || !indices.length || indices.length > 100 || indices.length !== lines?.length ||
        new Set(indices).size !== indices.length || stable(settings) !== stable(work.snapshot?.settings)) fail(400, 'Invalid unresolved window subset');
    for (const [position, index] of indices.entries()) if (!Number.isInteger(index) || index < 0 || !work.snapshot.lines[index] || stable(lines[position]) !== stable(work.snapshot.lines[index])) fail(400, 'The online subset differs from its reviewed package');
    const rows = db.WindowQuoteOnlineRequests, privateDb = privateOnlineDatabase(db, { hash, policy });
    const children = [];
    for (const [position, index] of indices.entries()) {
      const selectionHash = await digest({ package_id: work.id, input_hash: work.input_hash, index, settings, line: lines[position] });
      const query = { package_id: work.id, package_input_hash: work.input_hash, source_index: index };
      let matches = await rows.filter(query, 'created_date', 10);
      if (!matches.length) {
        const candidate = { version: 1, parent_quote_id: work.quote_id, package_id: work.id, package_input_hash: work.input_hash, source_index: index, selection_hash: selectionHash,
          request_id: 'package-online-' + selectionHash, title: ('AMSCO remaining window ' + (index + 1) + ' — ' + (work.snapshot.title || 'Glass Forge quote')).slice(0, 200),
          requester_email: work.owner_email, input_revision: 1, state_version: 0, worker_status: 'draft', sales_status: 'open', created_at: now().toISOString(),
          settings: clone(settings), lines: [clone(lines[position])], source: { reviewed_package: true, package_quote_id: work.quote_id, window_number: index + 1 },
          conversation: [], history: [], missing_details: [], checkpoint: {}, job_id: '', accepted_revision: 0 };
        if (!await onlinePackageIsCurrent(db, candidate, hash, policy)) fail(409, 'The parent package changed before online work was reserved');
        await rows.create(candidate);
        // Refetch after creation. A lost create reply is recovered on the next
        // call, and concurrent reservations must choose the same child record.
        matches = await rows.filter(query, 'created_date', 10);
      }
      const child = canonical(matches);
      if (!child || child.selection_hash !== selectionHash || !await onlinePackageIsCurrent(db, child, hash, policy)) fail(409, 'The saved online window differs from the current package');
      if (matches.some(other => other.id !== child.id && other.agent_run?.operation_id)) fail(409, 'Duplicate online operations require review before continuing');
      children.push(child);
    }
    // One request per online quote keeps each remaining product independently
    // recoverable. Only one new dispatch is attempted in this coordinator tick.
    if (allowDispatch) for (const [position, child] of children.entries()) {
      if (!['failed', 'needs_sign_in'].includes(child.worker_status) || (work.resume_count || 0) <= (child.resume_count || 0)) continue;
      const patch = { worker_status: 'queued', resume_count: work.resume_count, state_version: (child.state_version || 0) + 1, missing_details: [] };
      const changed = await rows.updateMany({ id: child.id, state_version: child.state_version || 0, worker_status: child.worker_status }, { $set: patch });
      if (changed.updated !== 1) fail(409, 'The saved online attempt changed before resuming');
      children[position] = { ...child, ...patch };
    }
    const next = children.find(child => child.worker_status === 'draft' || child.worker_status === 'queued' &&
      (!child.agent_run?.operation_id || child.agent_run.phase === 'completed' && ['failed', 'needs_sign_in'].includes(child.agent_run.terminal_status)));
    if (next && allowDispatch) {
      if (!await onlinePackageIsCurrent(db, next, hash, policy)) fail(409, 'The parent package changed before online dispatch');
      const updated = await execution.afterInput({ db: privateDb, q: next });
      children[children.findIndex(child => child.id === next.id)] = updated;
    }
    const completed = [];
    for (const child of children.filter(child => child.worker_status === 'ready')) {
      const checked = await verifyReady({ child, line: work.snapshot.lines[child.source_index], settings, work });
      if (checked?.ok !== true || !checked.verified) fail(502, 'The saved AMSCO online window does not match the reviewed selection');
      completed.push({ index: child.source_index, verified: checked.verified });
    }
    const attention = children.find(child => ['needs_details', 'needs_sign_in', 'failed'].includes(child.worker_status));
    if (attention) return { status: attention.worker_status, completed, questions: (attention.missing_details?.length ? attention.missing_details : ['Review the saved AMSCO attempt before continuing.']).map(question => 'Window ' + (attention.source_index + 1) + ': ' + question), child_id: attention.id };
    if (children.some(child => child.worker_status !== 'ready')) return { status: 'queued', completed };
    return { status: 'ready', completed, verified: completed.map(item => item.verified) };
  }

  async function route({ db, body }, action) {
    if (!id(body?.quote_id)) fail(400, 'Invalid quote identity');
    const children = await db.WindowQuoteOnlineRequests.filter({ id: body.quote_id }, undefined, 1);
    if (!children.length) return null;
    const child = children[0];
    // A failed terminal report may still release the child's browser lock after
    // its parent changes. New native mutations and Ready reports are forbidden.
    const reporting = action === 'report' || action === 'tool' && body.action === 'report';
    const cleanup = reporting && ['failed', 'needs_details', 'needs_sign_in'].includes(body.status);
    const terminalReplay = reporting && child.agent_run?.phase === 'completed' && (child.agent_run.event_ids || []).includes(body.event_id);
    if (!cleanup && !terminalReplay && !await onlinePackageIsCurrent(db, child, hash, policy)) fail(409, 'The package changed. Stop native changes and report the saved attempt as failed.');
    if (body.settings && stable(body.settings) !== stable(child.settings) || body.lines && stable(body.lines) !== stable(child.lines)) fail(400, 'This reviewed window schedule is fixed; report native options in the result without rewriting the requested schedule');
    if (reporting && body.status === 'ready' && !terminalReplay) {
      const work = (await db.WindowQuoteConfigurationPackages.filter({ id: child.package_id }, undefined, 1))[0];
      const candidate = { ...child, result: body.result, checkpoint: { ...child.checkpoint, ...body.checkpoint }, agent_run: { ...child.agent_run, verification: body.verification } };
      const verified = await verifyReady({ child: candidate, line: child.lines[0], settings: child.settings, work });
      if (verified?.ok !== true) fail(400, 'The observed AMSCO result must match this window’s size, quantity, finish and explicitly requested options');
    }
    const result = await execution[action]({ db: privateOnlineDatabase(db, { hash, policy }), body });
    if (action === 'tool' && body.action === 'read') result.contract = { ...result.contract,
      request_scope: 'This is one already-reviewed window from a larger package. Quote only the supplied line. Other windows already have prices or separate work. Keep settings and lines unchanged; record observed native selections in result.lines[0].options. Use AMSCO standard construction where no option was requested. Do not ask the customer to reconfirm standard defaults.',
      result_requirements: 'Observed dimensions, quantity, exterior and interior finishes, glass and all explicitly requested options must match this exact line. Reopen the saved quote before reporting its prices. If a requested choice cannot be built, report the specific conflict without substituting a different window.' };
    return result;
  }
  return { configured, progress, route };
}

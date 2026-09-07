// Pure public-intake adapter. There is deliberately no fallback provider.
export function createQuoteIntakeRouter({ scripted, config = {}, now = () => new Date() }) {
  return {
    configured: scripted.configured,
    provider: 'deterministic',
    afterInput: args => scripted.afterInput(args),
    async getStatus({ db }) {
      const status = { configured: false, online: false, provider: 'deterministic', name: 'Window quoting pilot', last_seen_at: null, browser_authenticated: null };
      if (!scripted.configured) return status;
      const workers = await db.QuoteWorkers.filter({ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash }, undefined, 2);
      if (workers.length !== 1 || !(workers[0].allowed_dealers || []).includes('BFS')) return status;
      status.configured = true;
      const quotes = await db.QuoteRequests.filter({ id: config.allow.quote_id }, undefined, 1);
      const q = quotes[0], run = q?.agent_run;
      if (!q || q.execution_provider !== 'deterministic' || q.input_revision !== config.allow.input_revision || q.request_id !== config.allow.request_id || q.requester_email !== config.allow.requester_email || run?.worker_id !== config.worker_id || run.plan_hash !== config.expected_plan_hash) return status;
      const timestamp = Date.parse(run.last_seen_at), started = Date.parse(run.started_at), age = now().getTime() - timestamp;
      // Only authenticated per-operation heartbeat writes set last_seen_at. A
      // credential/configuration record or another provider's slot activity does not.
      if (Number.isFinite(timestamp) && Number.isFinite(started) && timestamp >= started && age >= 0) status.last_seen_at = run.last_seen_at;
      status.online = q.worker_status === 'running' && run.phase === 'running' && status.last_seen_at !== null && age < 100000 && Date.parse(run.lease_expires_at) > now().getTime();
      return status;
    }
  };
}

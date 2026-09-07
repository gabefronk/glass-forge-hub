import { HttpError } from './windowQuotesCore.js';

export const SCRIPTED_CONFIG_KEY = 'amsco-scripted-pilot-v1';
const FIELDS = ['enabled', 'allow', 'worker_id', 'worker_key_hash', 'browser_slot_id', 'expected_plan_hash', 'lease_ms'];

// Fixed key, service-role-only call site. No cache, environment dependency or
// user-supplied selector. Duplicate records fail closed rather than picking one.
export async function loadScriptedRunnerConfig({ db }) {
  const rows = await db.WindowQuoteRunnerConfig.filter({ config_key: SCRIPTED_CONFIG_KEY }, undefined, 2);
  if (!rows.length) return { enabled: false };
  if (rows.length !== 1) throw new HttpError(503, 'The scripted pilot configuration requires one unique record');
  const row = rows[0];
  if (typeof row.enabled !== 'boolean') throw new HttpError(503, 'The scripted pilot configuration is invalid');
  return Object.fromEntries(FIELDS.filter(key => row[key] !== undefined).map(key => [key, structuredClone(row[key])]));
}

import { HttpError } from './windowQuotesCore.js';

export const SCRIPTED_CONFIG_KEY = 'amsco-scripted-pilot-v1';
const FIELDS = ['enabled', 'mode', 'queue_allow', 'allow', 'worker_id', 'worker_key_hash', 'browser_slot_id', 'expected_plan_hash', 'lease_ms'];
export const NATIVE_ENGINE_POLICY = Object.freeze({
  enabled: true,
  version: 1,
  contract_hash: 'ce17adadd395221f42eb5bf38b1cc9a1cb1a7ded914cdbf98e5331d049118c28',
  price_previews: true,
  configuration_quotes: true,
  catalog_id: '361',
  context_fingerprint: '1edbe92e64fa350fd31edc93872355016a697d13320234ed7645ac529faa06de'
});

// Fixed key, service-role-only call site. No cache, environment dependency or
// user-supplied selector. Duplicate records fail closed rather than picking one.
export async function loadScriptedRunnerConfig({ db }) {
  const rows = await db.WindowQuoteRunnerConfig.filter({ config_key: SCRIPTED_CONFIG_KEY }, undefined, 2);
  if (!rows.length) return { enabled: false };
  if (rows.length !== 1) throw new HttpError(503, 'The scripted pilot configuration requires one unique record');
  const row = rows[0];
  if (typeof row.enabled !== 'boolean') throw new HttpError(503, 'The scripted pilot configuration is invalid');
  if (row.mode !== undefined && !['pilot', 'queue'].includes(row.mode)) throw new HttpError(503, 'The scripted runner mode is invalid');
  const config = Object.fromEntries(FIELDS.filter(key => row[key] !== undefined).map(key => [key, structuredClone(row[key])]));
  // The desktop engine may report results only when both sides match this
  // reviewed build, AMSCO catalog and account context exactly.
  if (config.enabled === true && config.mode === 'queue') config.native_engine = structuredClone(NATIVE_ENGINE_POLICY);
  return config;
}


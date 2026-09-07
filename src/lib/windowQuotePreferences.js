const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'glassforge.windowQuotePreferences.v1.';
const BASIS = new Set(['call', 'frame', 'rough_opening']);
const EMPTY_SETTINGS = Object.freeze({ dealer: '', yard: '', gross_margin: '', color: '', glass: '' });
export const STANDARD_QUOTE_SETTINGS = Object.freeze({
  dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30,
  color: 'White', glass: 'CozE (LowE)'
});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 250 ? value.trim() : null;
function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }
function storageKey(userId) { return typeof userId === 'string' && userId.trim() ? STORAGE_PREFIX + encodeURIComponent(userId) : null; }
function productChoice(value) {
  const result = text(value);
  // These selections need request-specific notes, which are never carried to
  // another request. Keep the previous concrete preference instead.
  return result && result !== '__saved_selection__' && !/other\s*\/\s*mixed|see notes|describe in notes/i.test(result) ? result : null;
}
function cleanSettings(value) {
  if (!object(value)) return {};
  const settings = {};
  if (['BFS', 'BTB'].includes(value.dealer)) settings.dealer = value.dealer;
  if (text(value.yard)) settings.yard = text(value.yard);
  for (const key of ['color', 'glass']) if (productChoice(value[key])) settings[key] = productChoice(value[key]);
  const margin = value.gross_margin;
  if ((typeof margin === 'number' || typeof margin === 'string' && margin.trim() !== '') && Number.isFinite(Number(margin)) && Number(margin) >= 0 && Number(margin) < 100) settings.gross_margin = Number(margin);
  return settings;
}
function cleanPreferences(value) {
  if (!object(value)) return {};
  return {
    settings: cleanSettings(value.settings),
    ...(BASIS.has(value.dimension_basis) ? { dimension_basis: value.dimension_basis } : {}),
    ...(typeof value.use_standard === 'boolean' ? { use_standard: value.use_standard } : {})
  };
}
export function loadQuotePreferences(userId, storage = browserStorage()) {
  try {
    const key = storageKey(userId);
    if (!key || !storage) return {};
    const saved = JSON.parse(storage.getItem(key));
    return saved?.version === STORAGE_VERSION ? cleanPreferences(saved) : {};
  } catch { return {}; }
}
export function saveQuotePreferences(userId, values, storage = browserStorage()) {
  try {
    const key = storageKey(userId);
    if (!key || !storage) return false;
    const previous = loadQuotePreferences(userId, storage), next = cleanPreferences(values);
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, ...previous, ...next, settings: { ...previous.settings, ...next.settings } }));
    return true;
  } catch { return false; }
}
export function initialQuoteFormValues(initial, preferences = {}) {
  if (initial) return {
    settings: { ...EMPTY_SETTINGS, ...initial.settings },
    dimension_basis: initial.source?.easy_request?.dimension_basis || '',
    use_standard: initial.source?.easy_request?.confirmed === true
  };
  const saved = cleanPreferences(preferences);
  return {
    settings: { ...STANDARD_QUOTE_SETTINGS, ...saved.settings },
    dimension_basis: saved.dimension_basis || 'call',
    use_standard: saved.use_standard ?? true
  };
}

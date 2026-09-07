import { normalizeEasyRequest, STANDARD_STUDIO_PROFILE } from './easyRequest.js';
import { buildQuotePlan } from './amscoQuotePlan.js';

const singleHung = style => /^(studio)?singlehung$/.test(String(style || '').toLowerCase().replace(/[^a-z]/g, ''));
const present = value => value !== undefined && value !== null && value !== '';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function productDefaults(line, quote, getProductProfileForLine) {
  const easy = quote.source?.easy_request;
  const confirmed = easy?.confirmed === true && easy.profile_id === STANDARD_STUDIO_PROFILE.id && easy.profile_revision === STANDARD_STUDIO_PROFILE.revision;
  if (!confirmed || typeof getProductProfileForLine !== 'function') return structuredClone(line);
  const profile = getProductProfileForLine(line, quote.settings || {});
  // The registry is authored from native product evidence, never from model
  // output. Pending families cannot inherit the Single Hung recipe.
  if (profile?.status !== 'verified' || !object(profile.defaults)) return structuredClone(line);
  const supplied = object(line.options) ? line.options : {};
  const settings = quote.settings || {};
  const explicitSettings = Object.fromEntries(Object.keys(profile.defaults).filter(key => present(settings[key])).map(key => [key, settings[key]]));
  const options = { ...structuredClone(profile.defaults), ...explicitSettings, ...structuredClone(supplied) };
  const source = [supplied.color, supplied.exterior_color, supplied.interior_color].some(present) ? supplied : settings;
  const color = normalize(source.interior_color || source.color);
  const interior = { white: 'White', whitebothsides: 'White', taupe: 'Taupe', taupebothsides: 'Taupe' }[color];
  // A product may explicitly opt into matching colors for its native controls.
  // Picture profiles leave this empty and never acquire a latch or screen.
  for (const key of profile.match_interior_options || []) {
    if (!['hardware_color', 'screen'].includes(key)) continue;
    if (interior && !present(supplied[key]) && !present(settings[key])) options[key] = interior;
  }
  return { ...structuredClone(line), options };
}

// Called only after the server has interpreted the conversation. This bypasses
// the old prose grammar, while retaining recipe consent and the real planner.
export function normalizeConversationalSchedule(quote, { getProductProfileForLine } = {}) {
  const clean = { ...structuredClone(quote), message: '', request_text: '', conversation: [], history: [] };
  const normalized = normalizeEasyRequest(clean);
  const unsupported = (quote.lines || []).some(line => line.style && !singleHung(line.style));
  if (!unsupported) return normalized;
  // The Single Hung recipe must not turn an unrecognized product into a made-up
  // configuration with Single Hung hardware, glass thickness or fin choices.
  normalized.quote.lines = normalized.quote.lines.map((line, index) => {
    const original = quote.lines[index];
    return original?.style && !singleHung(original.style) ? productDefaults(original, quote, getProductProfileForLine) : line;
  });
  const checked = buildQuotePlan(normalized.quote);
  const issues = checked.issues || [];
  return { ...normalized, ok: checked.ok, issues, questions: [...new Set(issues.map(issue => issue.message))],
    ...(checked.ok ? { plan: checked.plan } : {}), preview: structuredClone(normalized.quote.lines) };
}

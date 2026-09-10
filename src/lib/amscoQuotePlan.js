// Same pure source ships to Base44 and the local runner. Legacy-only requests
// retain the exact v1 plan, including property order and its existing hash.
import { buildQuotePlan as buildLegacyPlan, verifyObservedQuote as verifyLegacyQuote, SUPPORT_ID, ROUNDING_POLICY, roomMatchesRequest } from './legacy-plan.js';
import { MIXED_SUPPORT_ID, PROFILE_CONTRACT_VERSION, PROFILE_CONTRACT_HASH, PRODUCT_PROFILES, normalizeProductText as norm, productFamily, getProductProfileForLine, getProductProfileById, resolveRequestedSeries, profileIsExecutable } from './mixedProductProfiles.js';
export { SUPPORT_ID, ROUNDING_POLICY, roomMatchesRequest, MIXED_SUPPORT_ID, PROFILE_CONTRACT_VERSION, PROFILE_CONTRACT_HASH, PRODUCT_PROFILES, getProductProfileForLine, getProductProfileById };
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && value !== '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const word = value => typeof value === 'string' ? value.trim() : '';
const issue = (issues, code, path, message) => issues.push({ code, path, message });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const validNativeQuoteId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const OPTION_KEYS = new Set(['series', 'fin', 'unit_type', 'color', 'exterior_color', 'interior_color', 'glass', 'glass_thickness', 'glazing_method', 'tempered', 'argon', 'super_spacer', 'capillary_tubes', 'grilles', 'hardware', 'hardware_color', 'screen', 'elevation', 'number_wide', 'operation', 'patterned_glass', 'sash_split']);
const FINANCE_KEYS = ['dealer', 'yard', 'gross_margin', 'markup', 'markup_percent', 'flat_markup', 'customer_price_override', 'tax', 'labor', 'freight', 'delivery'];
export function canonicalProductOption(rule, raw) {
  if (rule?.type === 'boolean') return typeof raw === 'boolean' && rule.values.includes(raw) ? raw : undefined;
  if (rule?.type === 'number') return finite(raw) && rule.values.includes(raw) ? raw : undefined;
  if (rule?.type !== 'choice' || typeof raw !== 'string') return undefined;
  const direct = rule.values.find(value => norm(value) === norm(raw));
  return direct ?? Object.entries(rule.aliases || {}).find(([alias]) => norm(alias) === norm(raw))?.[1];
}
export function savedDescriptionMatches(raw, requiredPhrases) {
  if (!Array.isArray(requiredPhrases) || requiredPhrases.length === 0) return true;
  if (typeof raw !== 'string' || raw.length > 8000) return false;
  const tokens = raw.split(/[,\r\n]+/).map(value => value.trim().toLowerCase());
  return requiredPhrases.every(phrase => typeof phrase === 'string' && tokens.includes(phrase.trim().toLowerCase()));
}
function canonicalColors(raw, settings, profile, issues, path) {
  const source = ['color', 'exterior_color', 'interior_color'].some(key => present(raw[key])) ? raw : settings;
  const named = { white: ['White', 'White'], whitebothsides: ['White', 'White'], taupe: ['Taupe', 'Taupe'], taupebothsides: ['Taupe', 'Taupe'], black: ['Black', 'Black'], blackbothsides: ['Black', 'Black'], blackoutsideblackinside: ['Black', 'Black'], blackexteriorblackinterior: ['Black', 'Black'], blackblack: ['Black', 'Black'], blackoutsidewhiteinside: ['Black', 'White'], blackexteriorwhiteinterior: ['Black', 'White'], blackwhite: ['Black', 'White'] };
  let pair = named[norm(source.color)];
  if (present(source.color) && !pair) issue(issues, 'ambiguous_color', path + '.color', 'Specify the exterior and interior colors clearly.');
  if (present(source.exterior_color) || present(source.interior_color)) {
    const names = { white: 'White', taupe: 'Taupe', black: 'Black' };
    const sides = [names[norm(source.exterior_color)], names[norm(source.interior_color)]];
    if (sides.some(value => !value)) issue(issues, 'missing_color_side', path, 'Specify both exterior and interior colors.');
    else if (pair && pair.some((value, index) => value !== sides[index])) issue(issues, 'conflicting_colors', path, 'The combined and separate exterior/interior colors disagree.');
    else pair = sides;
  }
  if (!pair) { issue(issues, 'missing_option', path + '.color', 'Specify exterior and interior colors for this product.'); return {}; }
  if (!profile.color_pairs.some(allowed => allowed[0] === pair[0] && allowed[1] === pair[1])) issue(issues, 'unsupported_colors', path + '.color', 'This product and color combination needs a verified native configuration.');
  return { color: pair[0] === pair[1] ? pair[0] : 'Black outside / White inside', exterior_color: pair[0], interior_color: pair[1] };
}
export function canonicalProductOptions(raw, settings, profile, issues = [], path = 'options', { observedDefaults = null } = {}) {
  if (!object(raw)) { issue(issues, 'invalid_options', path, 'Window options must be a structured object.'); raw = {}; }
  const allowed = new Set(['series', 'fin', 'color', 'exterior_color', 'interior_color', ...Object.keys(profile.option_rules)]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) issue(issues, 'unsupported_option', path + '.' + key, 'The supplied ' + key.replaceAll('_', ' ') + ' has no verified mapping for this product.');
  // A global product selection also cannot disappear merely because a line uses
  // another family. Missing/not-applicable fields require deliberate cleanup.
  for (const key of OPTION_KEYS) if (!allowed.has(key) && present(settings[key]) && !present(raw[key])) issue(issues, 'unsupported_option', path + '.' + key, 'The global ' + key.replaceAll('_', ' ') + ' does not apply to this verified product path.');
  if (resolveRequestedSeries({ options: raw }, settings) !== profile.series) issue(issues, 'conflicting_series', path + '.series', 'The requested series and fin must agree with the selected product.');
  const out = { series: profile.series, ...canonicalColors(raw, settings, profile, issues, path) };
  for (const [key, rule] of Object.entries(profile.option_rules)) {
    const supplied = present(raw[key]) ? raw[key] : settings[key];
    if (observedDefaults === null && !present(supplied) && profile.native_default_rules?.[key]) continue;
    const selectedRule = observedDefaults?.includes(key) ? profile.native_default_rules?.[key] : rule;
    const canonical = canonicalProductOption(selectedRule, supplied);
    if (canonical === undefined) issue(issues, present(supplied) ? 'unsupported_option' : 'missing_option', path + '.' + key,
      (present(supplied) ? 'Review the requested ' : 'Specify ') + key.replaceAll('_', ' ') + ' for ' + profile.style + '.');
    else out[key] = canonical;
  }
  return out;
}
export function nativeDefaultFieldsForLine(line) {
  const profile = getProductProfileById(line?.product_profile_id);
  return Object.keys(profile?.native_default_rules || {}).filter(key => !present(line?.options?.[key])).sort();
}
export function validateNativeDefaultEvidence(expected, observed) {
  const fields = nativeDefaultFieldsForLine(expected), issues = [], values = {};
  const profile = getProductProfileById(expected?.product_profile_id), evidence = observed?.native_default_evidence;
  const reject = message => issue(issues, 'native_default_evidence_invalid', 'native_default_evidence', message);
  const exactKeys = (value, keys) => object(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  if (!fields.length) {
    if (present(evidence)) reject('Unexpected native-default evidence for an explicitly configured line.');
    return { ok: issues.length === 0, issues, values };
  }
  const stages = ['before_save', 'after_save', 'reopened'];
  if (!exactKeys(evidence, stages)) reject('Native defaults require separate before-save, after-save and reopened observations.');
  else {
    for (const stage of stages) if (!exactKeys(evidence[stage], fields)) reject('Each native-default observation must contain exactly the planned ancillary fields.');
    for (const key of fields) {
      const rule = profile.native_default_rules[key], first = evidence.before_save?.[key];
      if (canonicalProductOption(rule, first) !== first || first === undefined) { reject('A native-default observation has an unsupported value or type.'); continue; }
      if (stages.some(stage => evidence[stage]?.[key] !== first) || observed?.options?.[key] !== first) reject('Native ancillary selections changed between configuration, saving and reopening.');
      else values[key] = first;
    }
  }
  return { ok: issues.length === 0, issues, values };
}
export function plannedDimensions(line, profile, issues = [], path = '') {
  const basis = profile.dimensions[line.dimension_basis];
  if (!basis) { issue(issues, 'unsupported_dimensions', path + '.dimension_basis', 'This product needs a verified ' + (line.dimension_basis || 'explicit dimension') + ' measurement path.'); return {}; }
  const entry = basis.cases?.find(item => item.width === line.width && item.height === line.height);
  if (entry) return { call_dimensions: { width: entry.call_width, height: entry.call_height, units: 'in' }, frame_dimensions: { width: entry.frame_width, height: entry.frame_height, units: 'in' } };
  if (line.dimension_basis === 'call' && basis.widths?.includes(line.width) && basis.heights?.includes(line.height) && finite(basis.frame_width_offset) && finite(basis.frame_height_offset)) {
    return { call_dimensions: { width: line.width, height: line.height, units: 'in' }, frame_dimensions: { width: line.width + basis.frame_width_offset, height: line.height + basis.frame_height_offset, units: 'in' } };
  }
  issue(issues, 'unsupported_dimensions', path, 'These dimensions are outside the verified native selections for this product.'); return {};
}
export function knownProductConstraints(line, path = '') {
  const options = line?.options || {}, pattern = options.patterned_glass ?? options.glass;
  const series = resolveRequestedSeries(line);
  if (productFamily(line?.style) === 'picture_direct_set' && line.width === 96 && line.height === 72 && options.tempered === true &&
      ['obscure', 'standardobscure', 'standardobscureglass'].includes(norm(pattern)) && (!series || series === 'Studio 1 3/8 inch Fin Setback')) {
    return [{ code: 'native_product_constraint', path: path + '.options.patterned_glass',
      message: (line.dimension_basis === 'call' ? 'AMSCO rejected the requested 96 × 72 call-size tempered picture window with Obscure glass: its glass is too large for the available Obscure sheet.' :
        'When treated as call sizes, AMSCO rejected a 96 × 72 tempered picture window with Obscure glass because its glass is too large for the available Obscure sheet. ' +
        (line.dimension_basis ? 'That test used call sizes; the requested measurement basis needs a separate native configuration check.' : 'Confirm the requested measurement basis and installation before checking the exact configuration.')) +
        ' Keep the requested privacy glass pending review; confirm a different glass option or a revised window configuration before quoting.',
      ...(line.dimension_basis ? {} : { customer_question: 'Are the 96 × 72 picture dimensions call size, frame size, or rough opening?' }),
      evidence: 'work/amsco-validation/picture-native-validation.json' }];
  }
  return [];
}
function failed(issues) {
  return { ok: false, status: 'needs_details', issues, questions: [...new Set(issues.map(item => {
    const line = item.path.match(/^lines\[(\d+)\]/); return (line ? 'Line ' + (Number(line[1]) + 1) + ': ' : '') + item.message;
  }))] };
}
export function buildQuotePlan(quote) {
  if (!Array.isArray(quote?.lines) || !quote.lines.length || quote.lines.every(line => productFamily(line?.style) === 'single_hung')) return buildLegacyPlan(quote);
  const issues = [], settings = object(quote.settings) ? quote.settings : {}, lines = [];
  if (!validId(quote.id)) issue(issues, 'missing_identity', 'id', 'A saved app request ID is required before quoting.');
  if (!Number.isSafeInteger(quote.input_revision) || quote.input_revision < 1) issue(issues, 'missing_revision', 'input_revision', 'A positive saved request revision is required before quoting.');
  const settingKeys = new Set([...OPTION_KEYS, ...FINANCE_KEYS]);
  for (const key of Object.keys(settings)) if (!settingKeys.has(key)) issue(issues, 'unsupported_setting', 'settings.' + key, 'The supplied setting ' + key + ' has no verified mapping.');
  if (settings.dealer !== 'BFS') issue(issues, 'unsupported_dealer', 'settings.dealer', 'Specify the BFS account for this supported workflow.');
  const yard = word(settings.yard);
  if (!yard || /please\s*select|unassigned|not\s*sure/i.test(yard)) issue(issues, 'missing_finance', 'settings.yard', 'Which actual BFS shipping yard should receive this quote?');
  if (!finite(settings.gross_margin) || settings.gross_margin < 0 || settings.gross_margin >= 100) issue(issues, 'missing_finance', 'settings.gross_margin', 'Specify a numeric gross margin from 0 up to, but not including, 100 percent.');
  for (const key of ['markup', 'markup_percent', 'flat_markup', 'customer_price_override']) if (present(settings[key])) issue(issues, 'unsupported_pricing', 'settings.' + key, 'Only gross-margin pricing is supported; resolve this additional pricing instruction.');
  for (const key of ['tax', 'labor', 'freight', 'delivery']) if (present(settings[key]) && settings[key] !== 0) issue(issues, 'unsupported_charge', 'settings.' + key, 'This workflow verifies a windows-only pretax subtotal.');
  if (quote.lines.length > 200) issue(issues, 'schedule_too_large', 'lines', 'Split the request into at most 200 lines.');
  else quote.lines.forEach((line, index) => {
    const path = 'lines[' + index + ']';
    if (!object(line)) { issue(issues, 'invalid_line', path, 'Each window line must be a structured object.'); return; }
    const family = productFamily(line.style);
    const constraints = knownProductConstraints(line, path);
    if (constraints.length) { issues.push(...constraints); return; }
    if (family === 'single_hung') {
      const legacy = buildLegacyPlan({ id: quote.id, input_revision: quote.input_revision, settings, lines: [line] });
      if (!legacy.ok) issues.push(...legacy.issues.map(item => ({ ...item, path: item.path.replace(/^lines\[0\]/, path) })));
      else lines.push({ ...legacy.plan.lines[0], source_index: index, product_profile_id: SUPPORT_ID });
      return;
    }
    const profile = getProductProfileForLine(line, settings);
    if (!profile) {
      // An unmapped product has no Studio recipe. Check its main inputs, then
      // preserve the exact options for AMSCO online configuration.
      if (!word(line.style) || norm(line.style) === 'custom') issue(issues, 'missing_style', path + '.style', 'Choose or describe the requested product.');
      if (line.units !== 'in') issue(issues, 'unsupported_units', path + '.units', 'Supply dimensions in inches.');
      for (const key of ['width', 'height']) if (!finite(line[key]) || line[key] <= 0 || line[key] > 1000) issue(issues, 'invalid_dimensions', path + '.' + key, 'Provide a positive numeric ' + key + ' in inches.');
      if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 1000) issue(issues, 'invalid_quantity', path + '.qty', 'Provide a whole-number quantity from 1 through 1000.');
      if (!['call', 'frame', 'rough_opening'].includes(line.dimension_basis)) issue(issues, 'missing_dimension_basis', path + '.dimension_basis', 'Choose call, frame or rough-opening measurements.');
      issue(issues, 'unsupported_product', path + '.style', 'This style and installation series need a verified product mapping.');
      return;
    }
    if (!profileIsExecutable(profile)) { issue(issues, 'unverified_product', path + '.style', profile.style + ' in ' + profile.series + ' still needs saved native validation.'); return; }
    if (line.units !== 'in') issue(issues, 'unsupported_units', path + '.units', 'Supply dimensions in inches (units: in).');
    for (const key of ['width', 'height']) if (!finite(line[key]) || line[key] <= 0 || line[key] > 1000) issue(issues, 'invalid_dimensions', path + '.' + key, 'Provide a positive numeric ' + key + ' in inches.');
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 1000) issue(issues, 'invalid_quantity', path + '.qty', 'Provide a whole-number quantity from 1 through 1000.');
    for (const key of ['components', 'mulls', 'shape']) if (present(line[key])) issue(issues, 'unsupported_assembly', path + '.' + key, 'This path supports a rectangular one-wide complete unit.');
    const options = canonicalProductOptions(line.options, settings, profile, issues, path + '.options');
    const nativeDefaultFields = nativeDefaultFieldsForLine({ product_profile_id: profile.id, options });
    if (Object.hasOwn(line, 'native_default_fields') && JSON.stringify(line.native_default_fields) !== JSON.stringify(nativeDefaultFields)) issue(issues, 'invalid_native_default_fields', path + '.native_default_fields', 'Native-default fields are derived from omitted options and the trusted product policy.');
    lines.push({ source_index: index, ...(present(line.mark) ? { mark: word(line.mark) } : {}), room: word(line.room), qty: line.qty,
      width: line.width, height: line.height, units: 'in', dimension_basis: line.dimension_basis, style: profile.style,
      ...plannedDimensions(line, profile, issues, path), options, ...(object(line.source_reference) ? { source_reference: clone(line.source_reference) } : {}), product_profile_id: profile.id,
      ...(nativeDefaultFields.length ? { native_default_fields: nativeDefaultFields } : {}) });
  });
  if (issues.length) return failed(issues);
  return { ok: true, plan: { schema_version: 2, support_id: MIXED_SUPPORT_ID, profile_contract_version: PROFILE_CONTRACT_VERSION,
    profile_contract_hash: PROFILE_CONTRACT_HASH, quote_id: quote.id, input_revision: quote.input_revision, title: word(quote.title),
    pricing_scope: 'windows_only_pretax', settings: { dealer: 'BFS', yard, gross_margin: settings.gross_margin }, lines } };
}
function cents(value) {
  if (!finite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) return null;
  return Math.round(value * 100);
}
function closeDimension(a, b) { return finite(a) && finite(b) && Math.abs(a - b) <= 0.000001; }
function sameYard(a, b) {
  const canonical = value => norm(word(value).replace(/\s*\(\d+\)\s*$/, ''));
  const id = value => word(value).match(/\((\d+)\)\s*$/)?.[1];
  return !!canonical(a) && canonical(a) === canonical(b) && (!id(b) || id(a) === id(b));
}
function marginMatches(value, requested) { return finite(value) && Math.abs(value - requested) <= ROUNDING_POLICY.displayed_margin_tolerance_percentage_points + 1e-9; }
export function assertSupportedPlan(plan) {
  if (plan?.schema_version === 1 && plan.support_id === SUPPORT_ID) return buildLegacyPlan({ id: plan.quote_id, input_revision: plan.input_revision, title: plan.title, settings: plan.settings, lines: plan.lines });
  if (!object(plan) || plan.support_id !== MIXED_SUPPORT_ID || plan.schema_version !== 2 || plan.profile_contract_version !== PROFILE_CONTRACT_VERSION || plan.profile_contract_hash !== PROFILE_CONTRACT_HASH) return { ok: false, status: 'failed', issues: [{ code: 'profile_contract_mismatch', path: 'plan', message: 'The server and runner product contracts must have the same version and hash.' }] };
  const rebuilt = buildQuotePlan({ id: plan.quote_id, input_revision: plan.input_revision, title: plan.title, settings: plan.settings, lines: plan.lines });
  if (!rebuilt.ok || JSON.stringify(rebuilt.plan.lines) !== JSON.stringify(plan.lines)) return { ok: false, status: 'failed', issues: [{ code: 'invalid_plan', path: 'plan', message: 'The plan no longer matches the verified product contract.' }, ...(!rebuilt.ok ? rebuilt.issues : [])] };
  return rebuilt;
}

export function verifyObservedQuote(plan, observed, verification = {}) {
  if (plan?.schema_version === 1 && plan.support_id === SUPPORT_ID) return verifyLegacyQuote(plan, observed, verification);
  const issues = [];
  const invalid = (code, path, message) => issue(issues, code, path, message);
  const rebuild = assertSupportedPlan(plan);
  if (!rebuild.ok) return { ...rebuild, status: 'failed' };
  plan = { ...rebuild.plan, ...(present(plan.native_quote_id) ? { native_quote_id: plan.native_quote_id } : {}) };
  if (!object(observed)) return { ok: false, status: 'failed', issues: [{ code: 'missing_observation', path: 'observed', message: 'A saved and reopened native quote observation is required.' }] };
  if (observed.reopened !== true) invalid('not_reopened', 'reopened', 'The native quote must be reopened before verification.');
  if (observed.quote_id !== plan.quote_id || observed.input_revision !== plan.input_revision) invalid('request_mismatch', 'quote_id', 'The observed quote must match this exact app request and revision.');
  if (typeof verification.validateIdentity === 'function') issues.push(...verification.validateIdentity(observed));
  else {
  if (!validNativeQuoteId(observed.native_quote_id) || !word(observed.native_quote_number)) invalid('native_identity_missing', 'native_quote_id', 'The saved native quote GUID and number must be observed.');
  let nativeUrl;
  try { nativeUrl = new URL(observed.native_quote_url); } catch { /* Invalid observation reported below. */ }
  if (!nativeUrl || nativeUrl.protocol !== 'https:' || nativeUrl.hostname !== 'amsco.wtsparadigm.com' || nativeUrl.username || nativeUrl.password || nativeUrl.pathname.split('/')[1] !== 'quotes' || nativeUrl.pathname.split('/')[2] !== observed.native_quote_id || nativeUrl.search || nativeUrl.hash) invalid('native_identity_mismatch', 'native_quote_url', 'The observed AMSCO quote link must identify the same saved native quote.');
  }
  if (present(plan.native_quote_id) && observed.native_quote_id !== plan.native_quote_id) invalid('checkpoint_mismatch', 'native_quote_id', 'The native quote differs from the retained checkpoint.');
  if (observed.dealer !== 'BFS') invalid('dealer_mismatch', 'dealer', 'The reopened dealer must be BFS.');
  if (!sameYard(observed.yard, plan.settings.yard)) invalid('yard_mismatch', 'yard', 'The reopened shipping yard does not match the request.');
  if (!marginMatches(observed.gross_margin, plan.settings.gross_margin)) invalid('margin_mismatch', 'gross_margin', 'The saved gross-margin setting is missing or differs from the request.');
  if (!word(observed.checked_at) || !Number.isFinite(Date.parse(observed.checked_at))) invalid('verification_time_missing', 'checked_at', 'Record when the reopened quote was verified.');
  if (!Array.isArray(observed.lines) || observed.lines.length !== plan.lines.length) invalid('line_count_mismatch', 'lines', 'Saved line count differs from the supported schedule.');
  const identities = new Set(), numbers = new Set();
  const sums = { list: 0, dealer: 0, customer: 0 };
  const resultLines = [];
  if (Array.isArray(observed.lines)) observed.lines.forEach((line, index) => {
    const expected = plan.lines[index], path = 'lines[' + index + ']';
    if (!expected) return;
    if (!object(line)) { invalid('missing_line', path, 'The saved native line observation is missing.');return; }
    if (!validId(line.native_line_id) || identities.has(line.native_line_id)) invalid('line_identity_invalid', path + '.native_line_id', 'Every saved line needs a distinct native ID.');
    identities.add(line.native_line_id);
    const number = String(line.native_line_number ?? '');
    if (!/^\d+$/.test(number) || Number(number) <= 0 || numbers.has(number)) invalid('line_number_invalid', path + '.native_line_number', 'Every saved line needs a distinct native line number.');
    numbers.add(number);
    if (line.qty !== expected.qty) invalid('quantity_mismatch', path + '.qty', 'Saved quantity differs from the schedule.');
    if (typeof verification.validateDimensions === 'function') issues.push(...verification.validateDimensions(expected, line, path));
    else {
    if (line.units !== 'in' || line.dimension_basis !== expected.dimension_basis || !closeDimension(line.width, expected.width) || !closeDimension(line.height, expected.height)) invalid('call_dimensions_mismatch', path, 'Saved call dimensions and units differ from the schedule.');
    if (!object(line.frame_dimensions) || line.frame_dimensions.units !== 'in' || !closeDimension(line.frame_dimensions.width, expected.frame_dimensions.width) || !closeDimension(line.frame_dimensions.height, expected.frame_dimensions.height)) invalid('frame_dimensions_mismatch', path + '.frame_dimensions', 'Observed frame dimensions do not match this supported call-size product.');
    }
    if (line.style !== expected.style || (line.product_profile_id !== expected.product_profile_id && !(expected.product_profile_id === SUPPORT_ID && line.product_profile_id === undefined))) invalid('style_mismatch', path + '.style', 'The saved product does not match the exact planned profile.');
    if (!verification.validateDimensions && expected.call_dimensions && (!object(line.call_dimensions) || line.call_dimensions.units !== 'in' || !closeDimension(line.call_dimensions.width, expected.call_dimensions.width) || !closeDimension(line.call_dimensions.height, expected.call_dimensions.height))) invalid('call_dimensions_mismatch', path + '.call_dimensions', 'Observed native call dimensions do not match the planned product.');
    if (!roomMatchesRequest(line.room, expected.room)) invalid('room_mismatch', path + '.room', 'The saved room label is missing or differs from the schedule.');
    const optionIssues = [];
    const profile = getProductProfileById(expected.product_profile_id);
    if (!savedDescriptionMatches(line.saved_description, profile?.summary.saved_description_phrases)) invalid('saved_feature_missing', path + '.saved_description', 'The saved native description is missing a required verified product feature.');
    let actualOptions;
    if (expected.product_profile_id === SUPPORT_ID) {
      const checked = buildLegacyPlan({ id: plan.quote_id, input_revision: plan.input_revision, settings: plan.settings, lines: [{ ...line, ...(verification.validateDimensions ? { width: expected.width, height: expected.height, dimension_basis: expected.dimension_basis } : {}) }] });
      if (!checked.ok) optionIssues.push(...checked.issues.map(item => ({ ...item, path: item.path.replace(/^lines\[0\]/, path) })));
      actualOptions = checked.ok ? checked.plan.lines[0].options : {};
    } else actualOptions = canonicalProductOptions(line.options, {}, profile, optionIssues, path + '.options', { observedDefaults: nativeDefaultFieldsForLine(expected) });
    if (optionIssues.length) issues.push(...optionIssues.map(item => ({ ...item, code: 'observed_' + item.code })));
    for (const [key, value] of Object.entries(expected.options)) if (actualOptions[key] !== value) invalid('option_mismatch', path + '.options.' + key, 'Saved ' + key.replaceAll('_', ' ') + ' differs from the requested option.');
    const defaults = validateNativeDefaultEvidence(expected, line);
    issues.push(...defaults.issues.map(item => ({ ...item, path: path + '.' + item.path })));
    if (!marginMatches(line.gross_margin, plan.settings.gross_margin)) invalid('margin_mismatch', path + '.gross_margin', 'The saved line gross margin is missing or differs from the request.');
    const priceCents = {};
    for (const kind of ['list', 'dealer', 'customer']) {
      const unit = cents(line.unit_prices?.[kind]), extended = cents(line.line_totals?.[kind]);
      priceCents[kind] = unit;
      if (unit === null || unit <= 0 || extended === null || extended <= 0) invalid('missing_native_price', path + '.' + kind, 'Positive native ' + kind + ' unit and extended prices in cents are required.');
      else {
        if (!Number.isSafeInteger(unit * expected.qty) || extended !== unit * expected.qty) invalid('extension_mismatch', path + '.line_totals.' + kind, 'Saved line extension does not equal the observed unit cents times quantity.');
        sums[kind] += extended;
      }
    }
    if (priceCents.dealer !== null && priceCents.customer !== null) {
      const expectedCustomer = Math.round(priceCents.dealer / (1 - plan.settings.gross_margin / 100));
      const marginTolerance = expected.options?.exterior_color === 'Black' ? ROUNDING_POLICY.studio_black_unit_margin_tolerance_cents : ROUNDING_POLICY.unit_margin_tolerance_cents;
      if (Math.abs(priceCents.customer - expectedCustomer) > marginTolerance) invalid('customer_margin_mismatch', path + '.unit_prices.customer', 'Observed customer price does not match the requested margin within the documented per-unit tolerance.');
    }
    const observedPrices = values => Object.fromEntries(['list', 'dealer', 'customer'].map(key => [key, values?.[key]]));
    resultLines.push({ ...clone(expected), ...(nativeDefaultFieldsForLine(expected).length ? { options: { ...clone(expected.options), ...defaults.values }, native_default_evidence: clone(line.native_default_evidence || {}) } : {}), native_line_id: line.native_line_id, native_line_number: number, unit_prices: observedPrices(line.unit_prices), line_totals: observedPrices(line.line_totals), gross_margin: line.gross_margin });
  });
  const totals = observed.totals;
  if (!object(totals) || totals.currency !== 'USD') invalid('totals_missing', 'totals', 'Observed native USD totals are required.');
  for (const [key, kind] of [['list_total', 'list'], ['dealer_cost', 'dealer'], ['customer_total', 'customer']]) if (cents(totals?.[key]) === null || cents(totals[key]) !== sums[kind]) invalid('total_mismatch', 'totals.' + key, 'Native ' + key + ' must equal the exact sum of saved line extensions.');
  for (const key of ['tax', 'freight', 'labor']) if (totals?.[key] !== 0) invalid('unsupported_or_missing_charge', 'totals.' + key, 'Observe and confirm zero ' + key + ' for this windows-only pretax scope.');
  if (present(totals?.total) && cents(totals.total) !== cents(totals.customer_total)) invalid('total_alias_mismatch', 'totals.total', 'The total alias must equal the observed customer total.');
  if (issues.length) return { ok: false, status: 'failed', issues };
  const cleanTotals = Object.fromEntries(['list_total', 'dealer_cost', 'customer_total', 'currency', 'tax', 'freight', 'labor'].map(key => [key, totals[key]]));
  return { ok: true, result: { verified: true, quote_id: plan.quote_id, input_revision: plan.input_revision, native_quote_id: observed.native_quote_id, native_quote_number: observed.native_quote_number, native_quote_url: observed.native_quote_url, dealer: 'BFS', yard: word(observed.yard), pricing_scope: plan.pricing_scope, lines: resultLines, totals: { ...cleanTotals, gross_margin: plan.settings.gross_margin }, verification: { profile_contract_version: PROFILE_CONTRACT_VERSION, profile_contract_hash: PROFILE_CONTRACT_HASH, reopened: true, checked_at: observed.checked_at, rounding_policy: clone(ROUNDING_POLICY) } } };
}


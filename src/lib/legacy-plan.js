// Pure planning and saved-result checks. No browser, credentials, catalog tables,
// model calls, network, or mutations are used in this module.
export const SUPPORT_ID = 'studio-setback-single-hung-v1';
export const ROUNDING_POLICY = Object.freeze({
  currency: 'USD', unit_margin_tolerance_cents: 1, aggregate_tolerance_cents: 0,
  displayed_margin_tolerance_percentage_points: 0.005,
  explanation: 'Saved native cents are authoritative. Prior portal/desktop comparison differed by one customer cent per unit because the margin-derived markup was displayed at different precision. Permit at most one cent versus the ideal margin calculation; require exact cents for quantity extensions and sums. This tolerance never supplies a missing price or margin.'
});
// Evidence for the bounded per-unit tolerance: the saved portal/desktop price
// comparison in outputs/amsco-online-quoting-notes.md, not a static price table.
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && value !== '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const word = value => typeof value === 'string' ? value.trim() : '';
const norm = value => word(value).toLowerCase().replace(/⅜/g, '3/8').replace(/⅛/g, '1/8').replace(/¾/g, '3/4').replace(/[–—]/g, '-').replace(/[^a-z0-9]+/g, '');
const issue = (issues, code, path, message) => issues.push({ code, path, message });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const validNativeQuoteId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const COLOR = new Map([['white', 'White'], ['taupe', 'Taupe'], ['black', 'Black']]);
const OPTION_KEYS = new Set(['series', 'unit_type', 'color', 'exterior_color', 'interior_color', 'glass', 'glass_thickness', 'glazing_method', 'tempered', 'argon', 'super_spacer', 'capillary_tubes', 'grilles', 'hardware', 'hardware_color', 'screen', 'elevation', 'number_wide']);
const SERIES = 'Studio 1 3/8 inch Fin Setback';
const SH_STYLE = 'Studio Single Hung';
const choice = (raw, values) => values.find(([aliases]) => aliases.includes(norm(raw)))?.[1];
const SERIES_CHOICES = [[['studio138inchfinsetback', 'studio138finsetback', 'studio138infinsetback'], SERIES]];
const UNIT_CHOICES = [[['completeunit'], 'Complete Unit']];
const STYLE_CHOICES = [[['singlehung', 'studiosinglehung'], SH_STYLE]];
const GLASS_CHOICES = [[['cozelowe'], 'CozE (LowE)']];
const THICKNESS_CHOICES = [[['ssoverss', 'ssss'], 'SS over SS']];
const GLAZING_CHOICES = [[['34inchinsulatedglass', '34inchinsulated', '34insulatedglass', '34insulated'], '3/4 inch Insulated Glass']];
const ELEVATION_CHOICES = [[['2501to6500', '25016500ft', '25016500feet', '25016500'], '2501 to 6500']];

function requiredChoice(raw, choices, issues, path, description) {
  if (!present(raw)) { issue(issues, 'missing_option', path, 'Please specify ' + description + '.');return undefined; }
  const value = choice(raw, choices);
  if (!value) issue(issues, 'unsupported_option', path, 'This first scripted product path does not support the supplied ' + description + '; it needs review.');
  return value;
}
function colorPair(raw) {
  const value = norm(raw);
  if (value === 'white' || value === 'whitebothsides') return ['White', 'White'];
  if (value === 'taupe' || value === 'taupebothsides') return ['Taupe', 'Taupe'];
  if (['blackoutsidewhiteinside', 'blackexteriorwhiteinterior', 'blackwhite'].includes(value)) return ['Black', 'White'];
  return null;
}
function colors(lineOptions, settings, issues, path) {
  const explicitSides = present(lineOptions.exterior_color) || present(lineOptions.interior_color);
  const explicitColor = present(lineOptions.color);
  const source = explicitSides || explicitColor ? lineOptions : settings;
  let pair = present(source.color) ? colorPair(source.color) : null;
  if (present(source.color) && !pair) issue(issues, 'ambiguous_color', path + '.color', 'Specify White on both sides, Taupe on both sides, or Black exterior with White interior.');
  const hasSides = present(source.exterior_color) || present(source.interior_color);
  if (hasSides) {
    const exterior = COLOR.get(norm(source.exterior_color)), interior = COLOR.get(norm(source.interior_color));
    if (!exterior || !interior) issue(issues, 'missing_color_side', path, 'Specify both exterior and interior colors explicitly.');
    else if (pair && (pair[0] !== exterior || pair[1] !== interior)) issue(issues, 'conflicting_colors', path, 'The combined color and individual exterior/interior colors disagree; confirm the intended colors.');
    else pair = [exterior, interior];
  }
  if (!pair) {
    if (!present(source.color) && !hasSides) issue(issues, 'missing_option', path + '.color', 'Which exterior and interior colors should this window use?');
    return {};
  }
  if (![['White', 'White'], ['Taupe', 'Taupe'], ['Black', 'White']].some(allowed => allowed[0] === pair[0] && allowed[1] === pair[1])) issue(issues, 'unsupported_colors', path, 'This first path supports White/White, Taupe/Taupe, or Black exterior/White interior only.');
  return { color: pair[0] === pair[1] ? pair[0] : 'Black outside / White inside', exterior_color: pair[0], interior_color: pair[1] };
}
function canonicalOptions(raw, settings, issues, path) {
  const supplied = object(raw) ? raw : {};
  if (raw !== undefined && !object(raw)) issue(issues, 'invalid_options', path, 'Window options must be a structured object.');
  for (const key of Object.keys(supplied)) if (!OPTION_KEYS.has(key)) issue(issues, 'unsupported_option', path + '.' + key, 'The supplied option ' + key + ' has no verified scripted mapping yet; review it before quoting.');
  const merged = {};
  for (const key of OPTION_KEYS) merged[key] = present(supplied[key]) ? supplied[key] : settings[key];
  const out = {
    series: requiredChoice(merged.series, SERIES_CHOICES, issues, path + '.series', 'the Studio installation series (this path requires 1 3/8 inch Fin Setback)'),
    unit_type: requiredChoice(merged.unit_type, UNIT_CHOICES, issues, path + '.unit_type', 'Complete Unit versus another unit type'),
    ...colors(supplied, settings, issues, path),
    glass: requiredChoice(merged.glass, GLASS_CHOICES, issues, path + '.glass', 'glass (this path requires CozE LowE)'),
    glass_thickness: requiredChoice(merged.glass_thickness, THICKNESS_CHOICES, issues, path + '.glass_thickness', 'glass thickness (this path supports SS over SS)'),
    glazing_method: requiredChoice(merged.glazing_method, GLAZING_CHOICES, issues, path + '.glazing_method', 'the 3/4 inch insulated glazing method'),
    elevation: requiredChoice(merged.elevation, ELEVATION_CHOICES, issues, path + '.elevation', 'elevation (this path currently supports 2501 to 6500 feet)')
  };
  for (const key of ['tempered', 'argon', 'super_spacer', 'capillary_tubes']) {
    if (typeof merged[key] !== 'boolean') issue(issues, 'missing_option', path + '.' + key, 'Specify whether ' + key.replaceAll('_', ' ') + ' is required (true or false).');
    else if (merged[key]) issue(issues, 'unsupported_option', path + '.' + key, 'The first scripted path only supports no ' + key.replaceAll('_', ' ') + '; review this requested variation.');
    else out[key] = false;
  }
  if (norm(merged.grilles) !== 'none') issue(issues, present(merged.grilles) ? 'unsupported_option' : 'missing_option', path + '.grilles', 'Confirm grilles: this first product path supports None only.');else out.grilles = 'None';
  if (merged.number_wide !== 1) issue(issues, present(merged.number_wide) ? 'unsupported_assembly' : 'missing_option', path + '.number_wide', 'Confirm one window wide (number_wide: 1); multi-window assemblies need a separate product path.');else out.number_wide = 1;
  const hardware = norm(merged.hardware);
  let parsedColor;
  if (hardware === 'camlatchtaupe' || hardware === 'camlatchtaupehardware') parsedColor = 'Taupe';
  if (hardware === 'camlatchwhite' || hardware === 'camlatchwhitehardware') parsedColor = 'White';
  if (!['camlatch', 'camlatchtaupe', 'camlatchtaupehardware', 'camlatchwhite', 'camlatchwhitehardware'].includes(hardware)) issue(issues, present(merged.hardware) ? 'unsupported_option' : 'missing_option', path + '.hardware', 'Specify Cam Latch hardware and its color.');else out.hardware = 'Cam Latch';
  const explicitHardwareColor = present(merged.hardware_color) ? COLOR.get(norm(merged.hardware_color)) : undefined;
  if (parsedColor && explicitHardwareColor && parsedColor !== explicitHardwareColor) issue(issues, 'conflicting_options', path + '.hardware_color', 'The hardware description and separate hardware color disagree.');
  out.hardware_color = explicitHardwareColor || parsedColor;
  if (!['White', 'Taupe'].includes(out.hardware_color)) issue(issues, 'missing_option', path + '.hardware_color', 'Specify supported White or Taupe hardware; do not infer it from the frame color.');
  out.screen = COLOR.get(norm(merged.screen));
  if (!out.screen) issue(issues, present(merged.screen) ? 'unsupported_option' : 'missing_option', path + '.screen', 'Specify the screen color explicitly: White, Taupe or Black.');
  return out;
}

export function buildQuotePlan(quote) {
  const issues = [];
  if (!object(quote)) return { ok: false, status: 'needs_details', issues: [{ code: 'invalid_request', path: '', message: 'Provide a structured quote request.' }], questions: ['Provide a structured quote request.'] };
  if (!validId(quote.id)) issue(issues, 'missing_identity', 'id', 'A saved app request ID is required before quoting.');
  if (!Number.isSafeInteger(quote.input_revision) || quote.input_revision < 1) issue(issues, 'missing_revision', 'input_revision', 'A positive saved request revision is required before quoting.');
  const settings = object(quote.settings) ? quote.settings : {};
  const settingKeys = new Set([...OPTION_KEYS, 'dealer', 'yard', 'gross_margin', 'markup', 'markup_percent', 'flat_markup', 'customer_price_override', 'tax', 'labor', 'freight', 'delivery']);
  for (const key of Object.keys(settings)) if (!settingKeys.has(key)) issue(issues, 'unsupported_setting', 'settings.' + key, 'The supplied setting ' + key + ' has no verified scripted mapping yet; review it before quoting.');
  if (settings.dealer !== 'BFS') issue(issues, present(settings.dealer) ? 'unsupported_dealer' : 'missing_finance', 'settings.dealer', 'Specify the BFS account; other dealers are not supported by this first scripted path.');
  const yard = word(settings.yard);
  if (!yard || /please\s*select|unassigned|not\s*sure/i.test(yard)) issue(issues, 'missing_finance', 'settings.yard', 'Which actual BFS shipping yard should receive this quote?');
  if (!finite(settings.gross_margin) || settings.gross_margin < 0 || settings.gross_margin >= 100) issue(issues, 'missing_finance', 'settings.gross_margin', 'Specify a numeric gross margin from 0 up to, but not including, 100 percent.');
  for (const key of ['markup', 'markup_percent', 'flat_markup', 'customer_price_override']) if (present(settings[key])) issue(issues, 'unsupported_pricing', 'settings.' + key, 'Only gross-margin pricing is supported; remove or resolve this additional pricing instruction.');
  for (const key of ['tax', 'labor', 'freight', 'delivery']) if (present(settings[key]) && settings[key] !== 0) issue(issues, 'unsupported_charge', 'settings.' + key, 'This first path verifies a windows-only pretax subtotal; requested ' + key + ' needs a separate supported workflow.');
  const lines = [];
  if (!Array.isArray(quote.lines) || !quote.lines.length) issue(issues, 'missing_schedule', 'lines', 'Provide a checked structured window schedule with dimensions, quantities and explicit options; free-text interpretation is a separate step.');
  else if (quote.lines.length > 200) issue(issues, 'schedule_too_large', 'lines', 'Split the request into at most 200 lines for this runner.');
  else quote.lines.forEach((line, index) => {
    const path = 'lines[' + index + ']';
    if (!object(line)) { issue(issues, 'invalid_line', path, 'Each window line must be a structured object.');return; }
    const style = requiredChoice(line.style, STYLE_CHOICES, issues, path + '.style', 'Single Hung style');
    if (line.dimension_basis !== 'call') issue(issues, 'unsupported_dimensions', path + '.dimension_basis', 'Confirm call dimensions; frame and rough-opening schedules require a separately verified conversion.');
    if (line.units !== 'in') issue(issues, 'unsupported_units', path + '.units', 'Supply dimensions in inches (units: in).');
    for (const key of ['width', 'height']) if (!finite(line[key]) || line[key] <= 0.5 || line[key] > 1000) issue(issues, 'invalid_dimensions', path + '.' + key, 'Provide a numeric call ' + key + ' greater than the half-inch frame deduction and no more than 1000 inches.');
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 1000) issue(issues, 'invalid_quantity', path + '.qty', 'Provide a whole-number quantity from 1 through 1000.');
    for (const key of ['components', 'mulls', 'shape']) if (present(line[key])) issue(issues, 'unsupported_assembly', path + '.' + key, 'This first path only supports a rectangular one-wide Single Hung complete unit.');
    const options = canonicalOptions(line.options, settings, issues, path + '.options');
    lines.push({ source_index: index, ...(present(line.mark) ? { mark: word(line.mark) } : {}), room: word(line.room), qty: line.qty, width: line.width, height: line.height, units: 'in', dimension_basis: 'call', style, frame_dimensions: { width: line.width - 0.5, height: line.height - 0.5, units: 'in' }, options, ...(object(line.source_reference) ? { source_reference: clone(line.source_reference) } : {}) });
  });
  if (issues.length) return { ok: false, status: 'needs_details', issues, questions: [...new Set(issues.map(item => {
    const line = item.path.match(/^lines\[(\d+)\]/);
    return (line ? 'Line ' + (Number(line[1]) + 1) + ': ' : '') + item.message;
  }))] };
  return { ok: true, plan: { schema_version: 1, support_id: SUPPORT_ID, quote_id: quote.id, input_revision: quote.input_revision, title: word(quote.title), pricing_scope: 'windows_only_pretax', settings: { dealer: 'BFS', yard, gross_margin: settings.gross_margin }, lines } };
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

// Live AMSCO evidence: an unassigned room is rendered as "None Assigned".
// Keep the raw observation; accept this sentinel only for a blank request.
export function roomMatchesRequest(actual, requested) {
  return typeof actual === 'string' && typeof requested === 'string' &&
    (actual.trim() === requested.trim() || requested.trim() === '' && actual.trim() === 'None Assigned');
}

export function verifyObservedQuote(plan, observed, verification = {}) {
  const issues = [];
  const invalid = (code, path, message) => issue(issues, code, path, message);
  if (!object(plan) || plan.support_id !== SUPPORT_ID || plan.schema_version !== 1) return { ok: false, status: 'failed', issues: [{ code: 'invalid_plan', path: 'plan', message: 'Use an accepted plan from buildQuotePlan.' }] };
  // Validate again rather than trusting a saved/mutated plan object.
  const rebuild = buildQuotePlan({ id: plan.quote_id, input_revision: plan.input_revision, settings: plan.settings, lines: plan.lines });
  if (!rebuild.ok) return { ok: false, status: 'failed', issues: [{ code: 'invalid_plan', path: 'plan', message: 'The saved plan no longer passes the supported product contract.' }, ...rebuild.issues] };
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
    if (line.units !== 'in' || line.dimension_basis !== 'call' || !closeDimension(line.width, expected.width) || !closeDimension(line.height, expected.height)) invalid('call_dimensions_mismatch', path, 'Saved call dimensions and units differ from the schedule.');
    if (!object(line.frame_dimensions) || line.frame_dimensions.units !== 'in' || !closeDimension(line.frame_dimensions.width, expected.frame_dimensions.width) || !closeDimension(line.frame_dimensions.height, expected.frame_dimensions.height)) invalid('frame_dimensions_mismatch', path + '.frame_dimensions', 'Observed frame dimensions do not match this supported call-size product.');
    }
    if (choice(line.style, STYLE_CHOICES) !== SH_STYLE) invalid('style_mismatch', path + '.style', 'The observed product is not the supported Studio Single Hung.');
    if (!roomMatchesRequest(line.room, expected.room)) invalid('room_mismatch', path + '.room', 'The saved room label is missing or differs from the schedule.');
    const optionIssues = [], actualOptions = canonicalOptions(line.options, {}, optionIssues, path + '.options');
    if (optionIssues.length) issues.push(...optionIssues.map(item => ({ ...item, code: 'observed_' + item.code })));
    for (const [key, value] of Object.entries(expected.options)) if (actualOptions[key] !== value) invalid('option_mismatch', path + '.options.' + key, 'Saved ' + key.replaceAll('_', ' ') + ' differs from the requested option.');
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
      if (Math.abs(priceCents.customer - expectedCustomer) > ROUNDING_POLICY.unit_margin_tolerance_cents) invalid('customer_margin_mismatch', path + '.unit_prices.customer', 'Observed customer price does not match the requested margin within the documented one-cent per-unit tolerance.');
    }
    const observedPrices = values => Object.fromEntries(['list', 'dealer', 'customer'].map(key => [key, values?.[key]]));
    resultLines.push({ ...clone(expected), native_line_id: line.native_line_id, native_line_number: number, unit_prices: observedPrices(line.unit_prices), line_totals: observedPrices(line.line_totals), gross_margin: line.gross_margin });
  });
  const totals = observed.totals;
  if (!object(totals) || totals.currency !== 'USD') invalid('totals_missing', 'totals', 'Observed native USD totals are required.');
  for (const [key, kind] of [['list_total', 'list'], ['dealer_cost', 'dealer'], ['customer_total', 'customer']]) if (cents(totals?.[key]) === null || cents(totals[key]) !== sums[kind]) invalid('total_mismatch', 'totals.' + key, 'Native ' + key + ' must equal the exact sum of saved line extensions.');
  for (const key of ['tax', 'freight', 'labor']) if (totals?.[key] !== 0) invalid('unsupported_or_missing_charge', 'totals.' + key, 'Observe and confirm zero ' + key + ' for this windows-only pretax scope.');
  if (present(totals?.total) && cents(totals.total) !== cents(totals.customer_total)) invalid('total_alias_mismatch', 'totals.total', 'The total alias must equal the observed customer total.');
  if (issues.length) return { ok: false, status: 'failed', issues };
  const cleanTotals = Object.fromEntries(['list_total', 'dealer_cost', 'customer_total', 'currency', 'tax', 'freight', 'labor'].map(key => [key, totals[key]]));
  return { ok: true, result: { verified: true, quote_id: plan.quote_id, input_revision: plan.input_revision, native_quote_id: observed.native_quote_id, native_quote_number: observed.native_quote_number, native_quote_url: observed.native_quote_url, dealer: 'BFS', yard: word(observed.yard), pricing_scope: plan.pricing_scope, lines: resultLines, totals: { ...cleanTotals, gross_margin: plan.settings.gross_margin }, verification: { reopened: true, checked_at: observed.checked_at, rounding_policy: clone(ROUNDING_POLICY) } } };
}



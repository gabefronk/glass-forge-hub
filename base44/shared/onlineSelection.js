const present = value => value !== undefined && value !== null && value !== '';
const norm = value => String(value ?? '').toLowerCase().replace(/amsco|\(low-?e\)|inches|inch|["'’]/g, '').replace(/[^a-z0-9]/g, '');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bool = value => value === true || /^(yes|true)$/i.test(String(value)) ? true : value === false || /^(no|false)$/i.test(String(value)) ? false : undefined;
const family = style => {
  const text = norm(style);
  for (const [match, value] of [[/casement/, 'casement'], [/awning/, 'awning'], [/singlehung|^sh$/, 'singlehung'], [/doublehung/, 'doublehung'], [/doublevent/, 'doublevent'], [/slider|singlevent/, 'singlevent'], [/picture|directset/, 'picture']]) if (match.test(text)) return value;
  return text;
};
const colorPair = value => ({ white: ['White', 'White'], whitewhite: ['White', 'White'], taupe: ['Taupe', 'Taupe'], taupetaupe: ['Taupe', 'Taupe'], black: ['Black', 'Black'], blackblack: ['Black', 'Black'], blackwhite: ['Black', 'White'], blackexteriorwhiteinterior: ['Black', 'White'] })[norm(value)];
const sameOption = (expected, actual) => typeof expected === 'boolean' ? bool(actual) === expected : typeof expected === 'number' ? finite(actual) && actual === expected : typeof actual === 'string' && norm(expected) === norm(actual);


// Compare explicit choices, leaving unrequested standard construction alone.
export function onlineSelectionIssues({ observed, line, settings }) {
  const issues = [], reject = message => issues.push(message), options = observed?.options;
  if (!observed || !line || !settings || !options || typeof options !== 'object' || Array.isArray(options)) return ['The requested and observed window options are required.'];
  if (family(observed.style) !== family(line.style)) reject('The observed window product differs from the requested product.');
  const frame = observed.frame_dimensions;
  if (!frame || frame.units !== 'in' || ![frame.width, frame.height].every(value => finite(value) && value > 0) || line.dimension_basis === 'frame' && (frame.width !== line.width || frame.height !== line.height)) reject('The quote needs matching saved frame dimensions.');
  const expected = { ...(line.options || {}) };
  for (const key of ['series', 'glass']) if (!present(expected[key]) && present(settings[key])) expected[key] = settings[key];
  if (!present(expected.series)) {
    const series = ['Hampton', 'Serenity', 'Studio', 'V2K BW'].find(value => norm(line.style).startsWith(norm(value)));
    if (series && !norm(options.series).startsWith(norm(series))) reject('The observed product series differs.');
  }
  const ownColor = ['color', 'exterior_color', 'interior_color'].some(key => present(expected[key]));
  const colorSource = ownColor ? expected : settings;
  const colors = colorPair(colorSource.color);
  if (colors) {
    if (norm(options.exterior_color) !== norm(colors[0]) || norm(options.interior_color) !== norm(colors[1])) reject('The observed exterior or interior finish differs.');
  } else if (present(colorSource.color) && !sameOption(colorSource.color, options.color)) reject('The observed finish differs.');
  for (const key of ['exterior_color', 'interior_color']) if (present(colorSource[key]) && !sameOption(colorSource[key], options[key])) reject('The observed ' + key + ' differs.');
  for (const [key, value] of Object.entries(expected)) {
    if (!present(value) || ['color', 'exterior_color', 'interior_color'].includes(key)) continue;
    if (!sameOption(value, options[key])) reject('The saved option differs or is missing: ' + key + '.');
  }
  if (/doublecasement|twincasement/.test(norm(line.style)) && options.number_wide !== 2) reject('The observed assembly must contain the requested two casements.');
  return issues;
}

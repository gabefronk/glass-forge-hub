import { normalizeConversationalSchedule } from '../../lib/structuredQuoteIntake.js';
import { STANDARD_STUDIO_PROFILE } from '../../lib/easyRequest.js';
import { getProductProfileForLine } from '../../lib/amscoQuotePlan.js';
import { productFamily, seriesFromFin } from '../../lib/mixedProductProfiles.js';

export const STYLE_CHOICES = Object.freeze([
  Object.freeze({ value: 'Studio Single Hung', label: 'Single Hung' }),
  Object.freeze({ value: 'Studio XO Slider', label: 'XO slider' }),
  Object.freeze({ value: 'Studio Picture', label: 'Picture' }),
  Object.freeze({ value: 'Custom', label: 'Other / custom' })
]);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && value !== '';
const text = value => typeof value === 'string' ? value.trim() : '';
const clone = value => structuredClone(value);
const problem = (code, path, message) => ({ code, path, message });
let localId = 0;
const freshId = () => globalThis.crypto?.randomUUID?.() || `builder-${Date.now().toString(36)}-${(++localId).toString(36)}`;
function styleName(style) {
  const compact = text(style).toLowerCase().replace(/[^a-z]/g, '');
  return ({ sh: 'Studio Single Hung', singlehung: 'Studio Single Hung', studiosinglehung: 'Studio Single Hung',
    xo: 'Studio XO Slider', xoslider: 'Studio XO Slider', studioxoslider: 'Studio XO Slider',
    picture: 'Studio Picture', picturewindow: 'Studio Picture', studiopicture: 'Studio Picture',
    directset: 'Studio Picture', studiodirectset: 'Studio Picture', custom: 'Custom' })[compact] || text(style);
}

/** New rows have no copied recipe or ancillary options. */
export function createBuilderLine(style = STYLE_CHOICES[0].value, overrides = {}) {
  const supplied = object(overrides) ? clone(overrides) : {};
  return { style: styleName(style), qty: 1, width: '', height: '', units: 'in', dimension_basis: 'call',
    room: '', mark: '', options: {}, ...supplied, id: freshId() };
}
export function duplicateBuilderLine(line) {
  if (!object(line)) throw new TypeError('Choose a window row to duplicate.');
  return { ...clone(line), id: freshId() };
}

/** Each pair is feet then inches; the four-digit notation has one inch digit. */
export function parseTradeCode(value) {
  const code = typeof value === 'number' && Number.isInteger(value) ? String(value) : text(value);
  const invalid = message => ({ ok: false, code, issues: [problem('invalid_trade_code', 'trade_code', message)] });
  if (!/^\d{4}$/.test(code)) return invalid('Use a four-digit feet-and-inches size code, such as 3050 or 5060.');
  const width = Number(code[0]) * 12 + Number(code[1]), height = Number(code[2]) * 12 + Number(code[3]);
  if (width <= 0 || height <= 0) return invalid('A size code must specify a positive width and height.');
  return { ok: true, code, width, height, units: 'in', dimension_basis: 'call', issues: [] };
}
export function formatTradeCode(width, height) {
  if (![width, height].every(value => typeof value === 'number' && Number.isInteger(value) && value > 0)) return '';
  const parts = [width, height].map(value => [Math.floor(value / 12), value % 12]);
  if (parts.some(([feet, inches]) => feet > 9 || inches > 9)) return '';
  return parts.map(([feet, inches]) => String(feet) + String(inches)).join('');
}

function numeric(value, { whole = false } = {}) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !value.trim()) return value;
  const pattern = whole ? /^\d+$/ : /^(?:\d+(?:\.\d+)?|\.\d+)$/;
  return pattern.test(value.trim()) ? Number(value.trim()) : value;
}
/** Normalizes field types and row identity, never combines or drops windows. */
export function normalizeBuilderLines(input) {
  if (!Array.isArray(input)) return { lines: [], issues: [problem('invalid_schedule', 'lines', 'Add a structured list of windows.')], idRepairs: [] };
  const issues = [], idRepairs = [], used = new Set(), reserved = new Set(input.filter(object).map(line => text(line.id)).filter(Boolean));
  const lines = input.map((original, index) => {
    const path = `lines[${index}]`, label = `Window ${index + 1}`;
    if (!object(original)) { issues.push(problem('invalid_line', path, `${label}: this row needs its window details restored.`)); return original; }
    let line;
    try { line = clone(original); } catch { issues.push(problem('invalid_line', path, `${label}: use plain window details.`)); return { id: `invalid-${index}`, original }; }
    const previousId = text(line.id);
    let id = previousId;
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || used.has(id)) {
      const prefix = /^[a-zA-Z0-9_-]{1,119}$/.test(previousId) ? previousId : `builder-line-${index + 1}`;
      let suffix = 1; id = `${prefix}-copy-${suffix}`;
      while (used.has(id) || reserved.has(id)) id = `${prefix}-copy-${++suffix}`;
      idRepairs.push({ index, previousId, id });
    }
    used.add(id); line.id = id;
    if (typeof line.style === 'string') line.style = styleName(line.style);
    if (!text(line.style)) issues.push(problem('missing_style', path + '.style', `${label}: choose a window style.`));
    for (const key of ['room', 'mark']) if (present(line[key]) && (typeof line[key] !== 'string' || line[key].length > 250)) issues.push(problem('invalid_label', path + '.' + key, `${label}: use a ${key} label of at most 250 characters.`));
    if (line.options === undefined) line.options = {};
    else if (!object(line.options)) issues.push(problem('invalid_options', path + '.options', `${label}: window choices must be a structured object.`));
    for (const key of ['width', 'height', 'qty']) line[key] = numeric(line[key], { whole: key === 'qty' });
    if (present(line.trade_code)) {
      const parsed = parseTradeCode(line.trade_code);
      if (!parsed.ok) issues.push(...parsed.issues.map(item => ({ ...item, path: path + '.trade_code', message: `${label}: ${item.message}` })));
      else {
        for (const key of ['width', 'height']) {
          if (!present(line[key])) line[key] = parsed[key];
          else if (line[key] !== parsed[key]) issues.push(problem('conflicting_size', path + '.' + key, `${label}: the size code and ${key} disagree.`));
        }
        if (!present(line.units)) line.units = 'in';
        if (!present(line.dimension_basis)) line.dimension_basis = 'call';
        else if (line.dimension_basis !== 'call') issues.push(problem('conflicting_size_basis', path + '.dimension_basis', `${label}: confirm whether the size code or the selected measurement basis should apply.`));
      }
    }
    for (const key of ['width', 'height']) if (present(line[key]) && (typeof line[key] !== 'number' || !Number.isFinite(line[key]) || line[key] <= 0)) issues.push(problem('invalid_dimensions', path + '.' + key, `${label}: enter a positive numeric ${key} in inches.`));
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 1000) issues.push(problem('invalid_quantity', path + '.qty', `${label}: enter a whole-number quantity from 1 to 1000.`));
    for (const key of ['notes', 'description', 'custom_style', 'custom_options', 'requirements', 'request_text', 'additional_notes', 'special_instructions']) {
      if (present(line[key]) && (typeof line[key] !== 'string' || text(line[key]))) issues.push(problem('written_requirement_review', path + '.' + key, `${label}: review its additional instructions with the AI helper.`));
    }
    return line;
  });
  if (!lines.length) issues.push(problem('missing_schedule', 'lines', 'Add at least one window.'));
  if (lines.length > 200) issues.push(problem('schedule_too_large', 'lines', 'Split this schedule into at most 200 window rows.'));
  return { lines, issues, idRepairs };
}

export function summarizeBuilderLines(lines) {
  const rows = Array.isArray(lines) ? lines : [], byStyle = [], groups = new Map();
  let unitCount = 0, quantityComplete = rows.length > 0;
  rows.forEach(line => {
    const quantity = numeric(line?.qty, { whole: true }), valid = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1000;
    if (!valid) quantityComplete = false; else unitCount += quantity;
    const style = styleName(line?.style) || 'Unspecified';
    if (!groups.has(style)) { const group = { style, lineCount: 0, unitCount: 0 };groups.set(style, group);byStyle.push(group); }
    groups.get(style).lineCount++; if (valid) groups.get(style).unitCount += quantity;
  });
  return { lineCount: rows.length, unitCount: quantityComplete ? unitCount : null, quantityComplete, byStyle,
    description: quantityComplete ? `${unitCount} ${unitCount === 1 ? 'window' : 'windows'} across ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : `${rows.length} window rows; check quantities` };
}

function standardSource(value) {
  if (!object(value)) return {};
  return Object.hasOwn(value, 'easy_request') ? clone(value) : Object.hasOwn(value, 'profile_id') ? { easy_request: clone(value) } : clone(value);
}
function fillStandardMainChoices(line, settings, source) {
  if (!object(line) || !object(line.options)) return line;
  const easy = source.easy_request || {}, out = clone(line), family = productFamily(out.style);
  if (!present(out.dimension_basis) && present(easy.dimension_basis)) out.dimension_basis = easy.dimension_basis;
  if (!present(out.units) && present(easy.units)) out.units = easy.units;
  const confirmed = easy.confirmed === true && easy.profile_id === STANDARD_STUDIO_PROFILE.id && easy.profile_revision === STANDARD_STUDIO_PROFILE.revision;
  if (!confirmed) return out;
  if (STYLE_CHOICES.some(choice => choice.value === out.style) && ['xo_slider', 'picture_direct_set'].includes(family)) {
    if (![out.options.fin, out.options.series, settings.fin, settings.series].some(present)) out.options.fin = 'nail fin';
    for (const [key, value] of [['tempered', false], ['patterned_glass', 'None']]) if (!present(out.options[key]) && !present(settings[key])) out.options[key] = value;
  }
  // An explicit Single Hung fin is an installation requirement, not a generic
  // unsupported option name. Convert only recognized fin labels, without loss.
  if (family === 'single_hung' && present(out.options.fin)) {
    const series = seriesFromFin(out.options.fin);
    if (series && (!present(out.options.series) || out.options.series === series)) { out.options.series = series;delete out.options.fin; }
  }
  return out;
}
function humanIssues(input, lines) {
  const custom = new Set(lines.flatMap((line, index) => object(line) && text(line.style) && !productFamily(line.style) ? [index] : []));
  const issues = input.filter(item => {
    const match = item.path?.match(/^lines\[(\d+)\]\.(style|options)(?:\.|$)/);
    return !match || !custom.has(Number(match[1])) || ['invalid_options', 'missing_style'].includes(item.code);
  });
  for (const index of custom) issues.push(problem('builder_product_review', `lines[${index}].style`, `Window ${index + 1}: this style needs product review before AMSCO pricing.`));
  return issues.map(item => {
    const match = item.path?.match(/^lines\[(\d+)\]/);
    return match && !/^Window \d+:/.test(item.message) ? { ...item, message: `Window ${Number(match[1]) + 1}: ${item.message}` } : item;
  });
}

/** Local validation preview only. Server intake still owns the saved revision,
 * plan hash and queue permission; this function supplies no prices. */
export function buildBuilderPreview(settings, inputLines, sourceValue) {
  const normalized = normalizeBuilderLines(inputLines), issues = [...normalized.issues];
  let selectedSettings = {}, source = {};
  try {
    if (!object(settings)) issues.push(problem('invalid_settings', 'settings', 'Choose the quote account and pricing settings.'));
    else selectedSettings = clone(settings);
    source = standardSource(sourceValue);
  } catch { issues.push(problem('invalid_settings', 'settings', 'Use plain quote settings and standard-profile choices.')); }
  if (present(selectedSettings.gross_margin)) selectedSettings.gross_margin = numeric(selectedSettings.gross_margin);
  const easy = source.easy_request || {};
  if (easy.confirmed === true && easy.profile_id === STANDARD_STUDIO_PROFILE.id && easy.profile_revision === STANDARD_STUDIO_PROFILE.revision && !present(selectedSettings.glass) && !Object.hasOwn(selectedSettings, 'low_e')) selectedSettings.glass = 'CozE (LowE)';
  const candidates = normalized.lines.map(line => fillStandardMainChoices(line, selectedSettings, source));
  const makeQuote = lines => ({ id: 'local-builder-preview', input_revision: 1, title: 'Window builder preview', settings: selectedSettings, source, lines });
  let checked;
  if (candidates.every(line => object(line) && object(line.options))) {
    try { checked = normalizeConversationalSchedule(makeQuote(candidates), { getProductProfileForLine });issues.push(...(checked.issues || [])); }
    catch { issues.push(problem('invalid_schedule', 'lines', 'Review these window details before requesting a native quote.')); }
  }
  const unique = [...new Map(humanIssues(issues, normalized.lines).map(item => [item.code + ':' + item.path + ':' + item.message, item])).values()];
  const globals = unique.filter(item => !/^lines\[\d+\]/.test(item.path));
  const lineReviews = normalized.lines.map((line, index) => {
    let own = unique.filter(item => item.path === `lines[${index}]` || item.path.startsWith(`lines[${index}].`));
    let valid = false;
    // A blocked earlier row must not hide validation of every other window.
    if (object(line) && object(candidates[index]) && object(candidates[index].options)) {
      try {
        const single = normalizeConversationalSchedule(makeQuote([candidates[index]]), { getProductProfileForLine });
        valid = single.ok === true;
        own = [...own, ...humanIssues(single.issues || [], [line]).map(item => ({ ...item, path: item.path.replace('lines[0]', `lines[${index}]`), message: item.message.replace(/^Window 1:/, `Window ${index + 1}:`) }))];
      } catch { own.push(problem('invalid_line', `lines[${index}]`, `Window ${index + 1}: review the supplied details.`)); }
    }
    const questions = [...new Set([...globals, ...own].map(item => item.message))];
    return { index, ok: valid && questions.length === 0, questions };
  });
  const ok = checked?.ok === true && unique.length === 0 && lineReviews.every(line => line.ok) && normalized.lines.length > 0;
  return { state: ok ? 'complete' : 'request_review', ok, lines: normalized.lines,
    normalizedLines: checked?.quote?.lines || candidates, settings: selectedSettings, source, issues: unique,
    questions: [...new Set([...unique.map(item => item.message), ...lineReviews.flatMap(line => line.questions)])], lineReviews,
    summary: summarizeBuilderLines(normalized.lines), pricing: 'live_amsco_required',
    ...(ok ? { plan: checked.plan } : {}) };
}

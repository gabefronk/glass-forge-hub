import { MAX_LINES, parseCSV } from './takeoff.js';
import { normalizeBuilderLines } from './windowBuilderModel.js';

// Keep this typed boundary aligned with the builder backend. Recognition here
// preserves a request; the strict product planner still decides availability.
export const BUILDER_IMPORT_OPTION_TYPES = Object.freeze({
  series: 'string', unit_type: 'string', color: 'string', exterior_color: 'string', interior_color: 'string', glass: 'string',
  glass_thickness: 'string', glazing_method: 'string', elevation: 'string', grilles: 'string', hardware: 'string', hardware_color: 'string',
  screen: 'string', operation: 'string', fin: 'string', viewing_direction: 'string', patterned_glass: 'string', sash_split: 'string', number_wide: 'number',
  tempered: 'boolean', argon: 'boolean', super_spacer: 'boolean', capillary_tubes: 'boolean'
});
const aliases = Object.freeze({ quantity: 'qty', count: 'qty', window_mark: 'mark', label: 'mark', type: 'style',
  window_style: 'style', width_in: 'width', height_in: 'height', basis: 'dimension_basis', dimension_type: 'dimension_basis',
  unit: 'units', location: 'room', grille: 'grilles' });
const lineKeys = new Set(['id', 'mark', 'room', 'style', 'qty', 'width', 'height', 'units', 'dimension_basis', 'options']);
const compactKeys = Object.fromEntries([...Object.keys(BUILDER_IMPORT_OPTION_TYPES), ...lineKeys, ...Object.keys(aliases)].map(key => [key.replaceAll('_', ''), key]));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && !(typeof value === 'string' && !value.trim());
const keyName = value => {
  const key = String(value).trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[\s-]+/g, '_');
  const named = Object.hasOwn(compactKeys, key) ? compactKeys[key] : key;
  return Object.hasOwn(aliases, named) ? aliases[named] : named;
};
const label = key => key.replaceAll('_', ' ');
function unsupported(path, key) {
  throw new Error(`${path}: “${label(key)}” cannot be imported as a structured choice. Keep that instruction and review it with the AI guide before importing.`);
}
function canonicalObject(value, path) {
  if (!object(value)) throw new Error(`${path} must be an object.`);
  const entries = [], seen = new Set();
  for (const [name, item] of Object.entries(value)) {
    const key = keyName(name);
    if (seen.has(key)) throw new Error(`${path}: duplicate “${label(key)}” fields. Keep one unambiguous value.`);
    seen.add(key); entries.push([key, item]);
  }
  return Object.fromEntries(entries);
}
function typedOption(value, key, path) {
  if (!present(value)) return undefined;
  const type = BUILDER_IMPORT_OPTION_TYPES[key];
  if (type === 'string' && typeof value === 'string') {
    if (value.trim().length <= 500) return value.trim();
  } else if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === 'string' && /^(true|false|yes|no|1|0)$/i.test(value.trim())) return /^(true|yes|1)$/i.test(value.trim());
  } else if (type === 'number') {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  throw new Error(`${path}: “${label(key)}” must be ${type === 'boolean' ? 'true/false or yes/no' : type === 'number' ? 'a number' : 'text of at most 500 characters'}.`);
}
function importLine(record, index) {
  const path = `Line ${index + 1}`, row = canonicalObject(record, path);
  let suppliedOptions = row.options ?? {};
  if (typeof suppliedOptions === 'string') {
    try { suppliedOptions = suppliedOptions.trim() ? JSON.parse(suppliedOptions) : {}; }
    catch { throw new Error(`${path}: options must be valid JSON.`); }
  }
  const nested = canonicalObject(suppliedOptions, `${path} options`), options = {}, line = {};
  for (const [key, value] of Object.entries(nested)) {
    if (!Object.hasOwn(BUILDER_IMPORT_OPTION_TYPES, key)) unsupported(`${path} options`, key);
    const typed = typedOption(value, key, path);
    if (typed !== undefined) options[key] = typed;
  }
  for (const [key, value] of Object.entries(row)) {
    if (Object.hasOwn(BUILDER_IMPORT_OPTION_TYPES, key)) {
      const typed = typedOption(value, key, path);
      if (typed !== undefined) {
        if (Object.hasOwn(options, key) && options[key] !== typed) throw new Error(`${path}: conflicting “${label(key)}” in the column and options object. Choose the intended value before importing.`);
        options[key] = typed;
      }
    } else if (!lineKeys.has(key)) unsupported(path, key);
    else if (key !== 'options') line[key] = value;
  }
  for (const key of ['id', 'mark', 'room', 'style', 'units', 'dimension_basis']) {
    if (present(line[key]) && typeof line[key] !== 'string') throw new Error(`${path}: ${label(key)} must be text.`);
    if (typeof line[key] === 'string') line[key] = line[key].trim();
  }
  const basis = keyName(line.dimension_basis ?? '');
  line.dimension_basis = ({ rough: 'rough_opening', ro: 'rough_opening', frame_size: 'frame', call_size: 'call' })[basis] || basis;
  const units = String(line.units ?? '').toLowerCase();
  line.units = ['in', 'inch', 'inches', '"'].includes(units) ? 'in' : units;
  return { ...line, options };
}

/** Atomic import: returns every row with typed explicit choices, or throws before
 * a caller replaces its existing schedule. No prices or native defaults inferred. */
export function parseBuilderImport(text, filename = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Paste a JSON or CSV schedule first.');
  if (text.length > 2_000_000) throw new Error('Keep schedules under 2 MB.');
  const content = text.replace(/^\uFEFF/, ''), isJSON = /\.json$/i.test(filename) || /^\s*[\[{]/.test(content);
  let decoded;
  try { decoded = isJSON ? JSON.parse(content) : parseCSV(content); }
  catch (error) { throw new Error(isJSON ? 'The schedule is not valid JSON. Check its formatting before importing.' : error.message); }
  let suppliedSource;
  if (!Array.isArray(decoded)) {
    if (!object(decoded)) throw new Error('Provide a JSON array or an object with lines.');
    for (const key of Object.keys(decoded)) if (!['lines', 'source'].includes(key)) unsupported('Schedule', key);
    if (decoded.source !== undefined) {
      if (!object(decoded.source)) throw new Error('Schedule source must be an object.');
      for (const [key, value] of Object.entries(decoded.source)) {
        if (!['filename', 'format'].includes(key)) unsupported('Schedule source', key);
        if (typeof value !== 'string') throw new Error(`Schedule source: ${key} must be text.`);
      }
      suppliedSource = structuredClone(decoded.source);
    }
  }
  const records = Array.isArray(decoded) ? decoded : decoded.lines;
  if (!Array.isArray(records) || !records.length) throw new Error('Include at least one window in the schedule.');
  if (records.length > MAX_LINES) throw new Error(`Use at most ${MAX_LINES} lines per request.`);
  const normalized = normalizeBuilderLines(records.map(importLine));
  const errors = normalized.issues.map(item => item.message);
  normalized.lines.forEach((line, index) => {
    for (const key of ['width', 'height']) if (!present(line[key])) errors.push(`Line ${index + 1}: ${key} is required.`);
    if (!['call', 'frame', 'rough_opening'].includes(line.dimension_basis)) errors.push(`Line ${index + 1}: specify call size, frame size or rough opening.`);
    if (line.units !== 'in') errors.push(`Line ${index + 1}: use inches; convert other units before importing.`);
  });
  if (errors.length) throw new Error([...new Set(errors)].join(' '));
  return { lines: normalized.lines, source: { filename: filename || 'Pasted takeoff', format: isJSON ? 'json' : 'csv', ...(suppliedSource ? { supplied: suppliedSource } : {}) } };
}

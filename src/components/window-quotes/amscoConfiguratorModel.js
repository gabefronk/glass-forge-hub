// Labels observed in AMSCO's online catalog. Listing a product does not certify pricing support.
export const AMSCO_SERIES = [
  ['Studio 1 3/8 inch Fin Setback', 'Studio 1 3/8" Fin Setback', 'Studio'],
  ['Studio Stucco Key Windows', 'Studio Stucco Key Windows', 'Studio'],
  ['Studio SK3', 'Studio SK3', 'Studio'],
  ['Studio Flush Fin', 'Studio Flush Fin', 'Studio'],
  ['Heritage Patio Doors', 'Heritage Patio Doors', 'Heritage'],
  ['Hampton', 'Hampton', 'Hampton'], ['Hampton SK', 'Hampton SK', 'Hampton'],
  ['Hampton Flush Fin', 'Hampton Flush Fin', 'Hampton'],
  ['Serenity', 'Serenity', 'Serenity'], ['V2K BW', 'V2K BW', 'V2K']
].map(([value, label, family]) => ({ value, label, family }));
const studio = [
  ['Studio XO Slider', 'Single Vent'], ['Studio Double Vent', 'Double Vent'],
  ['Studio Single Hung', 'Single Hung'], ['Studio Single Hung Geometrics', 'Single Hung Geometrics'],
  ['Studio Picture', 'Direct Set'], ['Studio Slider PW (Standalone)', 'Slider PW (Standalone)'],
  ['Studio Equal Lite PW', 'Equal Lite PW'], ['Studio PW Only Direct Set Continuous Frame', 'PW Only Direct Set Continuous Frame'],
  ['Studio Radius', 'Radius'], ['Studio Polygon', 'Polygon']
];
const hampton = [
  ['Hampton Single Vent', 'Single Vent'], ['Hampton Double Vent', 'Double Vent'],
  ['Hampton Single Hung', 'Single Hung'], ['Hampton Single Hung Geometrics', 'Single Hung Geometrics'],
  ['Hampton Direct Set', 'Direct Set'], ['Hampton Equal Lite Direct Set', 'Equal Lite Direct Set'],
  ['Hampton Sash Set Slider Frame', 'Sash Set Slider Frame'],
  ['Hampton Casement', 'Casement / Fixed Casement'], ['Hampton Awning', 'Awning / Fixed Awning'],
  ['Hampton Radius', 'Radius'], ['Hampton Polygon', 'Polygon']
];
// Rectangular products confirmed in AMSCO PK361 and generated/saved/reopened
// with native white/white CozE pricing. The pricing service decides each route.
const serenity = ['Single Vent', 'Double Vent', 'Single Hung', 'Casement', 'Awning', 'Direct Set'].map(style => ['Serenity ' + style, style]);
const v2k = ['Single Vent', 'Double Vent', 'Single Hung', 'Direct Set'].map(style => ['V2K BW ' + style, style]);
export function selectedSeries(line = {}) {
  if (line.options?.series) return line.options.series;
  if (/hampton.*flush/i.test(line.style || '')) return 'Hampton Flush Fin';
  if (/hampton.*\bsk\b/i.test(line.style || '')) return 'Hampton SK';
  if (/hampton/i.test(line.style || '')) return 'Hampton';
  if (/serenity/i.test(line.style || '')) return 'Serenity';
  if (/v2k/i.test(line.style || '')) return 'V2K BW';
  if (/studio.*sk3/i.test(line.style || '')) return 'Studio SK3';
  if (/flush/i.test(line.options?.fin || '')) return 'Studio Flush Fin';
  if (/studio|single hung|picture|slider/i.test(line.style || '')) return AMSCO_SERIES[0].value;
  return '';
}
export function stylesForSeries(series) {
  const family = AMSCO_SERIES.find(item => item.value === series)?.family;
  return (family === 'Studio' ? studio : family === 'Hampton' ? hampton : family === 'Serenity' ? serenity : family === 'V2K' ? v2k : []).map(([value, label]) => ({ value, label }));
}
// A new series replaces only the series choice. Dimensions and explicit job options survive.
// Retain a style shared by both series, otherwise require a new product selection.
export function changeSeries(line, series) {
  const current = stylesForSeries(selectedSeries(line)).find(item => item.value === line.style);
  const next = stylesForSeries(series).find(item => item.label === current?.label);
  return { ...line, style: next?.value || '', options: { ...line.options, series } };
}
export function colorParts(options = {}, settings = {}) {
  const color = options.color || settings.color || 'White';
  const pair = color.match(/^(.*?)\s+exterior\s*\/\s*(.*?)\s+interior$/i);
  return {
    exterior: options.exterior_color || pair?.[1] || color,
    interior: options.interior_color || pair?.[2] || color
  };
}
export function changeColor(options, settings, side, value) {
  const pair = { ...colorParts(options, settings), [side]: value };
  const next = { ...options };
  // Explicit edits replace the complete color pair so earlier imported fields cannot conflict.
  delete next.exterior_color; delete next.interior_color;
  next.color = pair.exterior === pair.interior ? pair.exterior : pair.exterior + ' exterior / ' + pair.interior + ' interior';
  return next;
}
export const GRILLE_TYPES = ['5/8" Flat', '13/16" Flat', '3/4" Sculptured', '1" SDL Low Profile', '1" SDL Sculptured', '2 1/4" SDL', '3 1/8" SDL'];
export function parseGrilles(value) {
  if (!value || value === 'None') return { mode: value ? 'none' : 'standard' };
  const match = value.match(/^(.*?) · Rectangular · (\d+)W(\d+)H per (lite|window) · (.*?)$/);
  if (!match || !GRILLE_TYPES.includes(match[1])) return { mode: 'custom', text: value };
  return { mode: 'rectangular', type: match[1], wide: Number(match[2]), high: Number(match[3]), scope: match[4], color: match[5] };
}
export function serializeGrilles(value) {
  if (value.mode === 'standard') return '';
  if (value.mode === 'none') return 'None';
  if (value.mode === 'custom') return value.text || '';
  if (!GRILLE_TYPES.includes(value.type) || !['lite', 'window'].includes(value.scope) ||
    ![value.wide, value.high].every(n => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 12) || !value.color?.trim()) {
    throw new TypeError('Choose a grille type, color and 1–12 lites wide and high.');
  }
  return value.type + ' · Rectangular · ' + Number(value.wide) + 'W' + Number(value.high) + 'H per ' + value.scope + ' · ' + value.color;
}
export function diagramPanels(line) {
  if (/single hung/i.test(line.style || '')) return { columns: 1, rows: 2, kind: 'hung' };
  if (/picture|direct set|\bPW\b|sash set|radius|polygon/i.test(line.style || '')) return { columns: 1, rows: 1, kind: 'fixed' };
  if (/double vent/i.test(line.style || '')) return { columns: 3, rows: 1, kind: 'slider' };
  if (/slider|single vent/i.test(line.style || '')) return { columns: 2, rows: 1, kind: 'slider' };
  if (/casement/i.test(line.style || '')) return { columns: Math.min(4, Math.max(1, Number(line.options?.number_wide) || 1)), rows: 1, kind: 'casement' };
  if (/awning/i.test(line.style || '')) return { columns: 1, rows: 1, kind: 'awning' };
  return { columns: 1, rows: 1, kind: 'custom' };
}

// Configurator selections shared by display, pricing, and saved quote payloads.
// Accessory colors follow the interior finish, including two-tone windows.
export function applyConfiguratorSelections(line, settings = {}) {
  if (!line?.style?.trim()) return line;
  const options = { ...line.options, unit_type: 'Complete Unit' };
  const { kind } = diagramPanels(line);
  if (kind === 'hung') options.sash_split = 'Even';
  if (['hung', 'slider', 'casement', 'awning'].includes(kind)) {
    const { interior } = colorParts(options, settings);
    options.hardware_color = interior;
    if (!/^none$/i.test(String(options.screen ?? ''))) options.screen = interior;
    if (/^cam latch(?:,\s*|\s+)(?:white|taupe|black)(?:\s+hardware)?$/i.test(options.hardware || '')) options.hardware = 'Cam Latch';
  }
  return { ...line, options };
}

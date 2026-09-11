// Lightweight standard-size selector metadata derived from the imported AMSCO PK361
// rectangular complete-unit dimensional grids. This is UI guidance only; the
// pricing planner remains the authority for product availability and pricing.
const prefixGrid = (widths, heights, counts = []) => ({
  widths,
  heightsByWidth: Object.fromEntries(widths.map((width, index) => [String(width), heights.slice(0, counts[index] ?? heights.length)]))
});
const exactGrid = entries => ({
  widths: Object.keys(entries).map(Number).sort((a, b) => a - b),
  heightsByWidth: Object.fromEntries(Object.entries(entries).map(([width, heights]) => [String(width), [...heights].sort((a, b) => a - b)]))
});

const six = (start, end) => Array.from({ length: Math.floor((end - start) / 6) + 1 }, (_, index) => start + index * 6);
const studioPictureHeights = [10, ...six(12, 126)];
const studioPictureWidths = [10, ...six(12, 126)];

const GRIDS = Object.freeze({
  studio_single_hung: prefixGrid(six(12, 54), six(24, 102)),
  studio_single_vent: prefixGrid(six(24, 102), six(12, 78)),
  studio_double_vent: prefixGrid(six(60, 126), six(12, 78)),
  studio_direct_set: exactGrid(Object.fromEntries(studioPictureWidths.map(width => [
    width,
    width === 10 ? [12] : width === 12 ? studioPictureHeights : width <= 78 ? six(12, 126) : six(12, 78)
  ]))),

  hampton_single_hung: prefixGrid([12, 18, 24, 30, 36, 42, 48, 60], [24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96, 108]),
  hampton_single_vent: prefixGrid([24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96, 108], [12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 84]),
  hampton_double_vent: prefixGrid([60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 126, 132, 138, 144, 156], [12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 84]),
  hampton_direct_set: prefixGrid([12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 132],
    [12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 132],
    [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 16, 16, 14, 14, 12, 12, 12, 12]),
  hampton_casement: prefixGrid(six(18, 48), six(24, 90)),
  hampton_awning: prefixGrid([18, 20, 24, 30, 36, 42, 48, 54, 60, 66], [14, 18, 20, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90], [15, 15, 15, 15, 15, 15, 15, 15, 9, 9]),

  serenity_single_hung: prefixGrid(six(12, 54), six(24, 90)),
  serenity_single_vent: prefixGrid(six(24, 84), six(12, 78)),
  serenity_double_vent: prefixGrid(six(60, 126), six(12, 78), [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 10, 10]),
  serenity_direct_set: prefixGrid([10, ...six(12, 126)], [10, ...six(12, 102)], [17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 13, 13, 13, 13, 13, 13, 9, 9]),
  serenity_casement: prefixGrid(six(18, 42), six(24, 78)),
  serenity_awning: prefixGrid([18, 20, 24, 30, 36, 42, 48, 54, 60, 66], [14, 18, 20, 24, 30, 36, 42]),

  v2k_single_hung: prefixGrid([24, 36, 48], [36, 48, 60, 72]),
  v2k_single_vent: exactGrid({ 24: [24, 36], 36: [24, 36, 42, 48], 48: [24, 36, 42, 48, 60], 60: [24, 36, 42, 48, 60], 72: [36, 48, 60] }),
  v2k_double_vent: prefixGrid(six(60, 96), six(12, 60)),
  v2k_direct_set: exactGrid({ 24: [36, 48, 60, 72], 36: [36, 48, 60, 72], 48: [36, 48, 60, 72], 60: [36, 48, 60, 72], 72: [36, 48, 60, 72] })
});

const compact = value => String(value || '').toLowerCase();
function productKind(style) {
  const value = compact(style);
  if (/geometric|radius|polygon|continuous|standalone|equal lite/.test(value)) return null;
  if (/single hung/.test(value)) return 'single_hung';
  if (/double vent/.test(value)) return 'double_vent';
  if (/single vent|xo slider/.test(value)) return 'single_vent';
  if (/casement/.test(value)) return 'casement';
  if (/awning/.test(value)) return 'awning';
  if (/picture|direct set/.test(value)) return 'direct_set';
  return null;
}
function seriesFamily(series) {
  const value = compact(series);
  if (value.startsWith('studio')) return 'studio';
  if (value.startsWith('hampton')) return 'hampton';
  if (value.startsWith('serenity')) return 'serenity';
  if (value.startsWith('v2k')) return 'v2k';
  return null;
}

export function standardSizeGrid(line, series) {
  const family = seriesFamily(series || line?.options?.series || line?.style);
  const kind = productKind(line?.style);
  const key = family && kind ? family + '_' + kind : '';
  const grid = GRIDS[key];
  return grid ? { key, label: 'AMSCO PK361 standard size grid', ...grid } : null;
}
export function standardWidths(line, series) {
  return standardSizeGrid(line, series)?.widths || [];
}
export function standardHeights(line, series, width) {
  const grid = standardSizeGrid(line, series);
  return grid?.heightsByWidth[String(Number(width))] || [];
}
export function isStandardSize(line, series, { allowPartial = false } = {}) {
  const grid = standardSizeGrid(line, series);
  if (!grid) return false;
  const hasWidth = line?.width !== '' && line?.width != null;
  const hasHeight = line?.height !== '' && line?.height != null;
  if (!hasWidth && !hasHeight) return allowPartial;
  const width = Number(line.width), height = Number(line.height);
  if (!grid.widths.includes(width)) return false;
  if (!hasHeight) return allowPartial;
  return grid.heightsByWidth[String(width)]?.includes(height) === true;
}
export function dimensionLabel(value) {
  const inches = Number(value);
  if (!Number.isFinite(inches)) return '';
  const feet = Math.floor(inches / 12), remainder = Number((inches - feet * 12).toFixed(3));
  return `${inches}" · ${feet}′${remainder}″`;
}

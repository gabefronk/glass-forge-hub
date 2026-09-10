// PK361 standard complete-unit glass construction, resolved per insulated unit.
// DrawingOffsets + Attributes group 6 and PK220 GetProportionParameters provide
// geometry. PK105 R390/R413 choose the first visible answer; PK210 Keep Minimum
// Glass applies it. This is display metadata, not a requested glass upgrade.
export const GLASS_CONSTRUCTION_VERSION = 'pk361-minimum-glass-v1';

export function minimumStandardGlass(width, height, tempered = false) {
  const w = Math.fround(width), h = Math.fround(height), area = Math.fround(w * h);
  if (!(w > 0 && h > 0) || Math.max(w,h) > 120 || area > 36 * 144) return null;
  if (Math.max(w,h) > 84 || area > 3600) return '3/16" over 3/16"';
  if (tempered || Math.max(w,h) > 66 || area > 2160) return 'DS over DS';
  // Rule 32886 hides SS/SS only; SS/DS is next in native AnswerOrder.
  if (Math.min(w,h) < 9 || Math.max(w,h) < 14) return 'SS over DS';
  return 'SS over SS';
}

export function sourceGlassConstruction(c) {
  if (!c || c.shape !== 'Rectangle' || c.unit_type !== 'Complete Unit' ||
      c.dimension_basis !== 'frame' || c.glass !== 'CozE (LowE)' ||
      c.glazing_method !== '3/4" Insulated' || c.tilted !== false ||
      typeof c.tempered !== 'boolean') return null;
  const w = Number(c.width), h = Number(c.height);
  if (!(w > 0 && h > 0) || w * h > 36 * 144) return null;
  let panes;
  const pane = (name, width, height) => ({name,width:Math.fround(width),height:Math.fround(height)});
  if (c.series === 'Studio' && c.product_type === 'Single Hung' && !c.tempered &&
      c.operation === 'Single Hung' && w >= 9 && w <= 48 && h >= 23 && h <= 96) {
    // Sample-room glass/frame attribute difference: 16.8125 - 19.25.
    // Bottom glass = H/2 - 2.4375; upper closes the remaining frame space.
    panes = [pane('Upper glass',w - 1.625,h / 2 - 1.6875),
      pane('Lower glass',w - 4.0625,h / 2 - 2.4375)];
  } else if (c.series === 'Studio' && c.product_type === 'Single Vent' && !c.tempered &&
      ['XO','OX'].includes(c.operation) && w >= 20 && w <= 96 && h >= 9 && h <= 72) {
    // Native group-6 left operating/fixed differences: -2.4375/-1.6875.
    const operating = pane(c.operation === 'XO' ? 'Left glass' : 'Right glass',w / 2 - 2.4375,h - 4.0625);
    const fixed = pane(c.operation === 'XO' ? 'Right glass' : 'Left glass',w / 2 - 1.6875,h - 1.625);
    panes = c.operation === 'XO' ? [operating,fixed] : [fixed,operating];
  } else if (c.series === 'Studio' && c.product_type === 'Direct Set' && !c.tempered &&
      c.operation === 'Fixed' && w >= 8 && w <= 120 && h >= 8 && h <= 120) {
    panes = [pane('Fixed glass',w - 1.6875,h - 1.6875)];
  } else if (c.series === 'Hampton' && c.product_type === 'Casement' &&
      ['Left','Right'].includes(c.operation) && w >= 17.5 && w <= 36 && h >= 23.5 && h <= 72 &&
      (!c.tempered || h <= 60)) {
    panes = [pane('Casement glass',w - 5.8125,h - 5.8125)];
  } else return null;
  for (const p of panes) {
    p.glass_thickness = minimumStandardGlass(p.width,p.height,c.tempered);
    if (!p.glass_thickness) return null;
  }
  const constructions = new Set(panes.map(p => p.glass_thickness));
  return {version:GLASS_CONSTRUCTION_VERSION,glass_thickness:constructions.size === 1 ? panes[0].glass_thickness : 'Differ',panes};
}

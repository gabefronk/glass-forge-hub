// Staged capability contract. Native dropdown evidence is not release evidence.
// Only this server/runner source registry may enable a product; requests cannot.
export const MIXED_SUPPORT_ID = 'studio-mixed-products-v2';
export const PROFILE_CONTRACT_VERSION = 1;
export const PROFILE_CONTRACT_HASH = '76c572a7219acec39ef34b812654c2902c54d5559468b504f59872e505d8e723';
const choice = (values, aliases = {}) => ({ type: 'choice', values, aliases });
const boolean = values => ({ type: 'boolean', values });
const common = {
  unit_type: choice(['Complete Unit']), glass: choice(['CozE (LowE)']),
  glazing_method: choice(['3/4 inch Insulated Glass'], { '3/4" Insulated': '3/4 inch Insulated Glass' }),
  elevation: choice(['2501 to 6500']), argon: boolean([false]), super_spacer: boolean([false]),
  capillary_tubes: boolean([false]), grilles: choice(['None']), number_wide: { type: 'number', values: [1] }
};
const slider = {
  ...common, operation: choice(['XO']), sash_split: choice(['Even']), tempered: boolean([false]),
  patterned_glass: choice(['None']), glass_thickness: choice(['SS over SS']),
  hardware: choice(['Cam Latch']), hardware_color: choice(['White']), screen: choice(['White'])
};
const sliderDefaults = Object.fromEntries(Object.entries(slider).map(([key, rule]) => [key, rule.values[0]]));
const sliderQuestionValues = { glazing_method: { '3/4 inch Insulated Glass': '3/4" Insulated' } };
const obscurePicture = {
  ...common, tempered: boolean([true]), patterned_glass: choice(['Obscure']),
  glazing_method: choice(['1 inch Insulated Glass'], { '1" Insulated': '1 inch Insulated Glass' }),
  glass_thickness: choice(['3/16 inch over 3/16 inch'], { '3/16" over 3/16"': '3/16 inch over 3/16 inch' }),
  super_spacer: boolean([true]), capillary_tubes: boolean([true])
};
const regularPicture = {
  ...obscurePicture, patterned_glass: choice(['None']),
  glass_thickness: choice(['1/4 inch over 1/4 inch'], { '1/4" over 1/4"': '1/4 inch over 1/4 inch' })
};
const commonInformationalLabels = ['Daylight Opening (Sq.Ft.)', 'Series Type', 'NFRC', 'Sound', 'Northern Zone', 'North-Central Zone',
  'South-Central Zone', 'Southern Zone', 'Performance Rating', 'Air Infiltration', 'Water Penetration', 'Test Report', 'PPT Code',
  'Product Category', 'Vendor Number', 'productDescription'];
const baseSummary = {
  option_labels: {
    unit_type: 'Unit Type', glass: 'Glass Type', glazing_method: 'Glazing Method',
    elevation: 'Window Installation Elevation (Ft Above Sea Level)', argon: 'Thermal Gas Added',
    super_spacer: 'Super Spacer', capillary_tubes: 'Capillary Tubes', grilles: 'Grille Type',
    number_wide: 'Number Wide', tempered: 'Tempered', patterned_glass: 'Patterned Glass',
    glass_thickness: 'Glass Thickness'
  },
  // Option fields not exposed in the app are still checked, not silently accepted.
  fixed_fields: { 'Internal Surface LowE': 'None', 'Glass Tint': 'None', 'Debris Protect': 'None',
    'Keep Minimum Glass Thickness': 'Yes', 'Glazing Tape Paper': 'Standard Glazing (Remove Paper)',
    'Grille Pattern': 'None', 'Protective Wrap': 'No', 'Request Type': 'None' }
};
const sliderSummary = {
  ...baseSummary,
  option_labels: { ...baseSummary.option_labels, operation: 'Operation / Venting', sash_split: 'Sash Split',
    hardware: 'Hardware Type', hardware_color: 'Hardware Finish' },
  fixed_fields: { ...baseSummary.fixed_fields, 'Equal Lite Adapter': 'No', 'Window Opening Control Device': 'No', 'Hide Bid Code In Description': 'No',
    'Sash Insert Reinforcement': 'No', 'Bottom Up Latch': 'No' },
  blank_fields: ['Bid Code', 'vendorShortConfigDesc'],
  fixed_optional_fields: { 'Vent Stop': 'No', 'Submit To Engineering For Review?': 'No' }, saved_required_fields: { 'Vent Stop': 'No' },
  informational_labels: [...commonInformationalLabels, 'Egress', 'Ventilation Opening (Sq.Ft.)', 'Vent Glass (w x h)', 'Deadlite Glass (w x h)', 'Screen Size (w x h)', 'Sash Size (w x h)'],
  screen: 'saved_grid_color'
};
const pending = ['saved_summary', 'saved_grid', 'reopened_summary', 'reopened_grid', 'verified_margin'];
const profiles = [
  {
    id: 'studio-flush-fin-xo-v1', status: 'verified', style: 'Studio XO Slider', family: 'xo_slider',
    series: 'Studio Flush Fin', native: { series: 'Studio Flush Fin', style: 'Single Vent', summary_style: 'Studio Flush Fin Single Vent', operation: 'XO', question_values: sliderQuestionValues },
    color_pairs: [['White', 'White']], option_rules: slider, defaults: sliderDefaults, match_interior_options: ['hardware_color', 'screen'], summary: sliderSummary,
    dimensions: { call: { widths: [24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96], heights: [12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72], frame_width_offset: -0.5, frame_height_offset: -0.5,
      cases: [{ width: 60, height: 60, call_width: 60, call_height: 60, frame_width: 59.5, frame_height: 59.5 }] } },
    evidence: { configurator: 'work/amsco-validation/flush-slider-final-summary.json',
      saved_summary: 'work/amsco-validation/flush-slider-final-summary.json', saved_grid: 'work/amsco-validation/flush-slider-saved-grid.json',
      reopened_summary: 'work/amsco-validation/flush-slider-reopened-summary.json', reopened_grid: 'work/amsco-validation/flush-slider-saved-grid.json',
      verified_margin: 'work/amsco-validation/flush-slider-saved-grid.json' }, pending_evidence: []
  },
  {
    id: 'studio-setback-xo-v1', status: 'verified', style: 'Studio XO Slider', family: 'xo_slider',
    series: 'Studio 1 3/8 inch Fin Setback', native: { series: 'Studio 1 3/8" Fin Setback', style: 'Single Vent', summary_style: 'Studio Single Vent', operation: 'XO', question_values: sliderQuestionValues },
    color_pairs: [['White', 'White']], option_rules: slider, defaults: sliderDefaults, match_interior_options: ['hardware_color', 'screen'],
    summary: { ...sliderSummary, fixed_fields: { ...sliderSummary.fixed_fields, 'Remove Nailing Fin': 'No', 'Sloped Sill Adapter': 'No', 'Head Expander': 'No' } },
    dimensions: { call: { widths: [24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96], heights: [12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72], frame_width_offset: -0.5, frame_height_offset: -0.5,
      cases: [{ width: 60, height: 60, call_width: 60, call_height: 60, frame_width: 59.5, frame_height: 59.5 }] } },
    evidence: { configurator: 'work/amsco-validation/nail-slider-final-summary.json', saved_summary: 'work/amsco-validation/nail-slider-final-summary.json',
      saved_grid: 'work/amsco-validation/nail-slider-saved-grid.json', reopened_summary: 'work/amsco-validation/nail-slider-reopened-summary.json',
      reopened_grid: 'work/amsco-validation/nail-slider-saved-grid.json', verified_margin: 'work/amsco-validation/nail-slider-saved-grid.json' }, pending_evidence: []
  },
  {
    id: 'studio-setback-direct-set-obscure-tempered-v1', status: 'verified', style: 'Studio Picture', family: 'picture_direct_set',
    series: 'Studio 1 3/8 inch Fin Setback', selection: { tempered: true, patterned_glass: 'Obscure' },
    native: { series: 'Studio 1 3/8" Fin Setback', style: 'Direct Set', summary_style: 'Studio Direct Set',
      question_values: { glazing_method: { '1 inch Insulated Glass': '1" Insulated' }, glass_thickness: { '3/16 inch over 3/16 inch': '3/16" over 3/16"' } } },
    color_pairs: [['White', 'White']], option_rules: obscurePicture,
    defaults: Object.fromEntries(Object.entries(obscurePicture).map(([key, rule]) => [key, rule.values[0]])),
    summary: { option_labels: baseSummary.option_labels,
      fixed_fields: { 'Wildfire Glazing': 'None', 'Internal Surface LowE': 'None', 'Debris Protect': 'None', 'Keep Minimum Glass Thickness': 'Yes',
        'Glazing Tape Paper': 'Standard Glazing (Remove Paper)', 'Grille Pattern': 'None', 'Protective Wrap': 'No', 'Request Type': 'None',
        'Remove Nailing Fin': 'No', 'Sloped Sill Adapter': 'No', 'Head Expander': 'No', 'Hide Bid Code In Description': 'No' },
      blank_fields: ['Bid Code', 'vendorShortConfigDesc'], fixed_optional_fields: { 'Submit To Engineering For Review?': 'No' },
      informational_labels: [...commonInformationalLabels, 'Fixed Glass (w x h)'],
      absent_labels: ['Hardware Type', 'Hardware Finish', 'Screen', 'Operation / Venting', 'Sash Split'], screen: 'not_applicable' },
    dimensions: { call: { cases: [{ width: 60, height: 60, call_width: 60, call_height: 60, frame_width: 59.5, frame_height: 59.5 }] } },
    evidence: { configurator: 'work/amsco-validation/picture-obscure-final-summary.json', saved_summary: 'work/amsco-validation/picture-obscure-final-summary.json',
      saved_grid: 'work/amsco-validation/picture-obscure-saved-grid.json', reopened_summary: 'work/amsco-validation/picture-obscure-reopened-summary.json',
      reopened_grid: 'work/amsco-validation/picture-obscure-saved-grid.json', verified_margin: 'work/amsco-validation/picture-obscure-saved-grid.json' }, pending_evidence: []
  },
  {
    id: 'studio-setback-direct-set-regular-tempered-v1', status: 'verified', style: 'Studio Picture', family: 'picture_direct_set',
    series: 'Studio 1 3/8 inch Fin Setback', selection: { tempered: true, patterned_glass: 'None' },
    native: { series: 'Studio 1 3/8" Fin Setback', style: 'Direct Set', summary_style: 'Studio Direct Set',
      question_values: { glazing_method: { '1 inch Insulated Glass': '1" Insulated' }, glass_thickness: { '1/4 inch over 1/4 inch': '1/4" over 1/4"' } },
      fixed_questions: [{ step: 'Advanced Options', label: 'Keep Minimum Glass Thickness', value: 'No', before: 'Glass Thickness' }] },
    color_pairs: [['White', 'White']], option_rules: regularPicture,
    defaults: Object.fromEntries(Object.entries(regularPicture).map(([key, rule]) => [key, rule.values[0]])),
    summary: { option_labels: baseSummary.option_labels,
      fixed_fields: { 'Wildfire Glazing': 'None', 'Internal Surface LowE': 'None', 'Glass Tint': 'None', 'Debris Protect': 'None', 'Keep Minimum Glass Thickness': 'No',
        'Glazing Tape Paper': 'Standard Glazing (Remove Paper)', 'Grille Pattern': 'None', 'Protective Wrap': 'No', 'Request Type': 'None',
        'Remove Nailing Fin': 'No', 'Sloped Sill Adapter': 'No', 'Head Expander': 'No', 'Hide Bid Code In Description': 'No' },
      blank_fields: ['Bid Code', 'vendorShortConfigDesc'], fixed_optional_fields: { 'Submit To Engineering For Review?': 'No' },
      informational_labels: [...commonInformationalLabels, 'Fixed Glass (w x h)'], saved_description_phrases: ['Wet Glaze'],
      absent_labels: ['Hardware Type', 'Hardware Finish', 'Screen', 'Operation / Venting', 'Sash Split'], screen: 'not_applicable' },
    dimensions: { call: { cases: [{ width: 96, height: 72, call_width: 96, call_height: 72, frame_width: 95.5, frame_height: 71.5 }] } },
    evidence: { configurator: 'work/amsco-validation/regular-picture-final-summary.json', saved_summary: 'work/amsco-validation/regular-picture-final-summary.json',
      saved_grid: 'work/amsco-validation/regular-picture-saved-grid.json', reopened_summary: 'work/amsco-validation/regular-picture-reopened-summary.json',
      reopened_grid: 'work/amsco-validation/regular-picture-saved-grid.json', verified_margin: 'work/amsco-validation/regular-picture-saved-grid.json' }, pending_evidence: []
  },
  ...['setback', 'flush-fin'].map(installation => ({
    id: `studio-${installation}-direct-set-v1`, status: 'pending', style: 'Studio Picture', family: 'picture_direct_set',
    series: installation === 'setback' ? 'Studio 1 3/8 inch Fin Setback' : 'Studio Flush Fin',
    native: { series: installation === 'setback' ? 'Studio 1 3/8" Fin Setback' : 'Studio Flush Fin', style: 'Direct Set' },
    color_pairs: [], option_rules: {}, defaults: {}, summary: { option_labels: {}, fixed_fields: {} }, dimensions: {}, evidence: {},
    pending_evidence: ['configurator', 'dimensions', ...pending]
  }))
];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const PRODUCT_PROFILES = freeze(profiles);
export const PRODUCT_PROFILE_MANIFEST = freeze({ contract_version: PROFILE_CONTRACT_VERSION, support_id: MIXED_SUPPORT_ID, profiles });
export const normalizeProductText = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/⅜/g, '3/8').replace(/¾/g, '3/4').replace(/[^a-z0-9]+/g, '') : '';
const norm = normalizeProductText;
export function productFamily(style) {
  const key = norm(style);
  if (['singlehung', 'studiosinglehung'].includes(key)) return 'single_hung';
  if (['xoslider', 'studioxoslider', 'xoslidingwindow', 'singlevent', 'studiosinglevent', 'studioflushfinsinglevent'].includes(key)) return 'xo_slider';
  if (['picture', 'picturewindow', 'studiopicture', 'directset', 'studiodirectset', 'studioflushfindirectset'].includes(key)) return 'picture_direct_set';
}
export function canonicalSeries(value) {
  if (['studioflushfin', 'flushfin'].includes(norm(value))) return 'Studio Flush Fin';
  if (['studio138inchfinsetback', 'studio138finsetback', 'studio138infinsetback'].includes(norm(value))) return 'Studio 1 3/8 inch Fin Setback';
}
export function seriesFromFin(value) {
  if (['flushfin', 'flush'].includes(norm(value))) return 'Studio Flush Fin';
  if (['nailfin', 'nailingfin', 'regularnailfin', 'standardnailfin', '138finsetback', '138inchfinsetback'].includes(norm(value))) return 'Studio 1 3/8 inch Fin Setback';
}
export function resolveRequestedSeries(line, settings = {}) {
  const raw = line?.options || {};
  const source = raw.series !== undefined || raw.fin !== undefined ? raw : settings;
  const hasSeries = source.series !== undefined && source.series !== null && source.series !== '';
  const hasFin = source.fin !== undefined && source.fin !== null && source.fin !== '';
  const explicit = hasSeries ? canonicalSeries(source.series) : undefined, fin = hasFin ? seriesFromFin(source.fin) : undefined;
  if ((hasSeries && !explicit) || (hasFin && !fin) || (explicit && fin && explicit !== fin)) return undefined;
  return explicit || fin;
}
export function getProductProfileForLine(line, settings = {}) {
  const family = productFamily(line?.style), series = resolveRequestedSeries(line, settings);
  return PRODUCT_PROFILES.find(profile => profile.family === family && profile.series === series &&
    Object.entries(profile.selection || {}).every(([key, expected]) => {
      const actual = line?.options?.[key] ?? settings[key];
      return typeof expected === 'boolean' ? actual === expected : norm(actual) === norm(expected);
    }));
}
export function getProductProfileById(id) { return PRODUCT_PROFILES.find(profile => profile.id === id); }
export function getProductProfileForSummary(summary) {
  const series = canonicalSeries(summary?.Series), style = norm(summary?.Style);
  return PRODUCT_PROFILES.find(profile => profile.series === series && profile.native.summary_style && norm(profile.native.summary_style) === style &&
    Object.entries(profile.selection || {}).every(([key, expected]) => {
      const actual = summary?.[profile.summary.option_labels[key]];
      return typeof expected === 'boolean' ? norm(actual) === (expected ? 'yes' : 'no') : norm(actual) === norm(expected);
    }));
}
export function profileIsExecutable(profile) {
  return profile?.status === 'verified' && profile.pending_evidence?.length === 0 &&
    ['configurator', 'saved_summary', 'saved_grid', 'reopened_summary', 'reopened_grid', 'verified_margin'].every(key => typeof profile.evidence?.[key] === 'string' && profile.evidence[key]) &&
    Object.keys(profile.dimensions || {}).length > 0 && Object.keys(profile.option_rules || {}).length > 0 &&
    typeof profile.native?.summary_style === 'string' && profile.color_pairs?.length > 0;
}


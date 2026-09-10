// Independent, versioned AMSCO rule calculator. No browser, AI, or network calls.
// Imported rate coverage and implemented rule coverage are deliberately separate.
import { catalog as pk358 } from './amscoTransferredCatalog358.js';
import { catalog as pk361 } from './amscoTransferredCatalog361.js';

const catalogs = Object.freeze({ '358': pk358, '361': pk361 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const known = (value, choices) => choices.includes(value);
const key = (code, group) => JSON.stringify([code, String(group)]);
export class CatalogCoverageError extends Error {
  constructor(code, detail) { super(detail); this.name = 'CatalogCoverageError'; this.code = code; }
}
const requireValue = (condition, code, detail) => { if (!condition) throw new CatalogCoverageError(code, detail); };
export const roundCurrency = value => Math.round((value + Number.EPSILON) * 100) / 100;
// The transferred controls use decimal rounding. Snap binary representation noise,
// then apply the documented upward increment, without rounding a genuine remainder down.
export function roundUp(value, increment) {
  requireValue(finite(value) && finite(increment) && increment > 0, 'invalid_number', 'Invalid rounding input.');
  return Math.ceil(Number((value / increment).toFixed(9))) * increment;
}
export function getTransferredCatalog(catalogId, priceBook = 1) {
  requireValue(typeof catalogId === 'string' && Object.hasOwn(catalogs, catalogId), 'catalog_not_supported', 'This catalog has not been imported.');
  requireValue(priceBook === 1, 'pricebook_not_supported', 'This calculation requires the Main pricebook.');
  return catalogs[catalogId];
}
export function dimensionLookup(catalog, code, width, height, group = 0) {
  requireValue(finite(width) && finite(height) && width > 0 && height >= 0, 'invalid_dimensions', 'Enter positive dimensions.');
  const rows = catalog.dimensional_grids[key(code, group)];
  requireValue(rows?.length, 'price_code_not_supported', 'The selected price code has no imported rate grid.');
  const widths = [...new Set(rows.map(r => r[0]))].sort((a,b) => a-b);
  const heights = [...new Set(rows.map(r => r[1]))].sort((a,b) => a-b);
  const w = widths.find(n => n >= width), h = heights.find(n => n >= height);
  requireValue(w !== undefined && h !== undefined, 'dimensions_outside_price_grid', 'This size exceeds the imported price grid.');
  const found = rows.filter(r => r[0] === w && r[1] === h);
  requireValue(found.length === 1, 'price_cell_unresolved', 'This exact size-grid cell requires review.');
  return { value: found[0][2], row_id: found[0][3], cell: { width: w, height: h }, price_code: code, group_id: String(group) };
}
export function attributeLookup(catalog, code, attr1, attr2 = '', group = 0) {
  const found = (catalog.attributes[key(code,group)] || []).filter(row => row[0] === attr1 && row[1] === attr2);
  requireValue(found.length === 1, 'attribute_rate_unresolved', 'The requested option has no unique imported rate.');
  return { value: found[0][2], row_id: found[0][3], price_code: code, group_id: String(group), attr1, attr2 };
}
export function numberedAttributeLookup(catalog, group, attr1, attr2 = '') {
  const found = (catalog.numbered_attributes[String(group)] || []).filter(row => row[0] === String(attr1) && row[1] === String(attr2));
  requireValue(found.length === 1, 'numbered_attribute_rate_unresolved', 'The requested option has no unique imported group rate.');
  return { value: found[0][3], row_number: found[0][4], group_id: String(group), attr1: String(attr1), attr2: String(attr2) };
}
export function frameArea(catalog, width, height) {
  const tableWidth = dimensionLookup(catalog, 'Table Width', width, 0);
  const tableHeight = dimensionLookup(catalog, 'Table Height', height, 0);
  return { value: roundUp(tableWidth.value * 0.006944 * tableHeight.value, 1), unit: 'sq_ft', rule_ids: [1521,1522,1523,1524], table_width: tableWidth, table_height: tableHeight };
}
const studio = new Set(['Studio','Studio SK','Studio SK3','Studio Flush Fin']);
const hampton = new Set(['Hampton','Hampton SK','Hampton Flush Fin']);
const componentTypes = ['Glass Only','Frame Only','Sash Only','Screen Only','Flat Trim Only'];
export function selectTransferredBase(configuration) {
  const c = configuration;
  requireValue(c && typeof c === 'object' && !Array.isArray(c), 'invalid_configuration', 'A window configuration is required.');
  requireValue(c.unit_type === 'Complete Unit' && !componentTypes.includes(c.unit_type), 'unit_type_not_implemented', 'Component-only pricing requires additional rules.');
  requireValue(c.shape === 'Rectangle', 'shape_not_implemented', 'This shape requires additional configuration rules.');
  if (studio.has(c.series) && c.product_type === 'Single Hung' && c.tilted === false) return { price_code: 'Studio Single Hung Base', rule_id: 778, category: 'VMULT' };
  if (studio.has(c.series) && c.product_type === 'Single Vent' && known(c.operation,['XO','OX'])) return { price_code: 'Studio Single Vent Base', rule_id: 776, category: 'VMULT' };
  if (studio.has(c.series) && c.product_type === 'Direct Set' && c.operation === 'Fixed') return { price_code: 'Studio Direct Set PW Base', rule_id: 782, category: 'VMULT' };
  if (hampton.has(c.series) && c.product_type === 'Casement' && known(c.operation, ['Left','Right'])) return { price_code: 'Hampton Casement Base', rule_id: 24154, category: 'VMULT' };
  if (hampton.has(c.series) && c.product_type === 'Fixed Casement' && c.operation === 'Fixed') return { price_code: 'Hampton Fixed Casement Base', rule_id: 24156, category: 'VMULT' };
  throw new CatalogCoverageError('product_rules_not_implemented', 'This product needs additional rule integration.');
}
const discountRates = Object.freeze({ VMULT: .5444, ALUM: .5444, Renaissance: .5444, Glass: .3699, VRF: .368, Flat50: .5 });
export function applyTransferredDiscount(list, category, clientId) {
  requireValue(clientId === '00000000-0000-0000-1555-000000000000', 'client_not_mapped', 'This client needs its own discount mapping.');
  requireValue(Object.hasOwn(discountRates, category), 'discount_category_not_mapped', 'This product needs its own discount category.');
  return { dealer: roundCurrency(list * (1-discountRates[category])), category, discount: discountRates[category], factor: 1-discountRates[category], client_id: clientId };
}
const configKeys = ['series','product_type','unit_type','shape','operation','tilted','width','height','dimension_basis','exterior_color','interior_color','preserve','grille_application_id','glass','tempered','glazing_method','stock_glass','wildfire_glazing','quantity'];

// This API calculates only its explicitly implemented rule scope. It does not
// certify size/answer validity or silently promote historical rates to a live quote.
export function calculateTransferredWindow(input) {
  try {
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'invalid_request', 'A pricing request is required.');
    requireValue(Object.keys(input).every(k => ['catalog_id','price_book','configuration','client_id','gross_margin'].includes(k)), 'unhandled_request_field', 'The request contains an unhandled pricing selection.');
    const catalog = getTransferredCatalog(input.catalog_id, input.price_book), c = input.configuration;
    const baseSelection = selectTransferredBase(c);
    requireValue(Object.keys(c).every(k => configKeys.includes(k)), 'unhandled_option', 'The configuration contains an option whose pricing rules are not integrated.');
    requireValue(c.dimension_basis === 'frame', 'measurement_conversion_not_implemented', 'This calculation requires resolved frame dimensions.');
    requireValue(finite(c.width) && finite(c.height) && c.width > 0 && c.height > 0, 'invalid_dimensions', 'Enter positive frame dimensions.');
    requireValue(Number.isSafeInteger(c.quantity) && c.quantity > 0 && c.quantity <= 1000, 'invalid_quantity', 'Enter a whole-number quantity from 1 to 1000.');
    requireValue(c.glass === 'CozE (LowE)' && typeof c.tempered === 'boolean', 'glass_rules_not_implemented', 'This glass choice requires additional pricing rules.');
    requireValue(c.glazing_method === undefined || c.glazing_method === '3/4" Insulated', 'glazing_rules_not_implemented', 'This glazing method requires additional pricing rules.');
    requireValue(c.stock_glass === undefined || c.stock_glass === false, 'stock_glass_rules_not_implemented', 'Stock-glass selection requires additional pricing rules.');
    requireValue(c.wildfire_glazing === undefined || c.wildfire_glazing === 'None', 'wildfire_rules_not_implemented', 'Wildfire glazing requires additional pricing rules.');
    if (c.tempered) requireValue(hampton.has(c.series) && c.product_type === 'Casement' && c.glazing_method === '3/4" Insulated' && c.stock_glass === false && c.wildfire_glazing === 'None'
      && input.client_id === '00000000-0000-0000-1555-000000000000', 'tempered_context_required', 'Tempered pricing requires the mapped complete glazing and client context.');
    requireValue(known(c.preserve,['None','Both','Inside','Outside']), 'preserve_not_supported', 'Choose a supported protective-film option.');
    requireValue(Number.isInteger(c.grille_application_id) && known(c.grille_application_id,[0,1]), 'grille_rules_not_implemented', 'This grille application requires additional rules.');
    const colorPair = c.exterior_color + '/' + c.interior_color;
    requireValue(known(colorPair,['White/White','Black/White','Black/Black']), 'color_rules_not_implemented', 'This finish requires additional color rules.');
    requireValue(colorPair !== 'Black/Black' || c.grille_application_id === 0, 'grille_color_rules_not_implemented', 'Black interior grille pricing requires its color rules.');
    if (input.gross_margin !== undefined) requireValue(finite(input.gross_margin) && input.gross_margin >= 0 && input.gross_margin < 100, 'invalid_margin', 'Gross margin must be from zero to less than 100 percent.');
    const base = dimensionLookup(catalog,baseSelection.price_code,c.width,c.height);
    const area = frameArea(catalog,c.width,c.height);
    const components = [{ name: 'Base Price', value: base.value, rule_ids: [baseSelection.rule_id], source: base }];
    let adjustedBase = base.value;
    if (colorPair === 'Black/White') {
      const factor = studio.has(c.series) ? 1.94 : 1.45, rule = studio.has(c.series) ? 16200 : 23299;
      adjustedBase = roundCurrency(roundUp(base.value*factor,.1));
      components[0] = { ...components[0], value: adjustedBase, rule_ids: [...components[0].rule_ids,rule], color_factor: factor, unadjusted_value: base.value };
    }
    if (colorPair === 'Black/Black') {
      // PB1 copies the uncolored base to a temporary modifier, scales that copy,
      // then overwrites Base Price. Never compound the exterior-only multiplier.
      const factor = studio.has(c.series) ? 2.5 : 1.8;
      const ruleIds = studio.has(c.series) ? [23360,22131,22178] : [23360,37758,37756];
      adjustedBase = roundCurrency(roundUp(base.value*factor,.1));
      components[0] = { ...components[0], value: adjustedBase, rule_ids: [...components[0].rule_ids,...ruleIds], color_factor: factor, unadjusted_value: base.value,
        temporary_modifier: 'Base Price (Temp)', assignment: 'overwrite_from_uncolored_temporary_base' };
    }
    if (c.tempered) {
      const rate = numberedAttributeLookup(catalog,28,c.glazing_method,'Yes');
      components.push({ name: 'Tempered Add-On', value: roundCurrency(roundUp(rate.value*area.value,.1)), quantity: area.value, rate: rate.value, rule_ids: [873,883], source: rate });
    }
    if (c.preserve !== 'None') {
      const rate = attributeLookup(catalog,'Preserve',c.preserve);
      components.push({ name: 'Debris Protect', value: roundCurrency(roundUp(rate.value*area.value,.1)), quantity: area.value, rate: rate.value, rule_ids: [1560,1561], source: rate });
    }
    if (c.grille_application_id !== 0) {
      const rate = numberedAttributeLookup(catalog,5,c.grille_application_id);
      components.push({ name: 'Grille Add-On', value: roundCurrency(rate.value*area.value), quantity: area.value, rate: rate.value, rule_ids: [1812,1815], source: rate });
    }
    const list = roundCurrency(components.reduce((sum,item) => sum+item.value,0));
    const discount = input.client_id ? applyTransferredDiscount(list,baseSelection.category,input.client_id) : null;
    const prices = { list, ...(discount ? { dealer: discount.dealer } : {}), ...(discount && input.gross_margin !== undefined ? { customer: roundCurrency(discount.dealer/(1-input.gross_margin/100)) } : {}) };
    return { status: 'calculated', production_ready: false, validation_scope: 'source_rule_calculation; full_configuration_validity_pending', catalog_id: catalog.catalog_id, price_book: catalog.price_book,
      source: catalog.source, base_selection: baseSelection, frame_area: area, components, discount, unit_prices: prices,
      line_totals: Object.fromEntries(Object.entries(prices).map(([k,v]) => [k,roundCurrency(v*c.quantity)])), quantity: c.quantity };
  } catch (error) {
    if (!(error instanceof CatalogCoverageError)) throw error;
    return { status: 'needs_online', production_ready: false, code: error.code, message: error.message, unit_prices: null, line_totals: null };
  }
}
export function transferredEngineStatus() {
  return { engine: 'amsco_source_rules', version: 1, execution: 'Base44 backend; no browser or local runner required', production_ready: false,
    catalogs: Object.values(catalogs).map(c => ({ catalog_id: c.catalog_id, price_book: c.price_book, dimensional_rows: Object.values(c.dimensional_grids).reduce((n,r) => n+r.length,0), grid_keys: Object.keys(c.dimensional_grids).length, source: c.source })),
    implemented: ['Studio non-tilt single hung, single vent, direct set base','Hampton operating/fixed casement base','White/white','Black/white','Black/black using original temporary base','table-banded frame area','Preserve','standard rectangular 5/8 flat grille arithmetic','Hampton casement whole-window tempering with mapped standard glazing','client 1555 category discounts'],
    remaining: ['full configuration validity and defaults','additional product and option rules','current online comparison before live-price promotion'] };
}

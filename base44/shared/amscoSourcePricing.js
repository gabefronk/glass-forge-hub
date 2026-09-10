import { calculateTransferredWindow } from './amscoTransferredEngine.js';
import { buildNativeCatalogPlan, catalogStableJson } from './nativeCatalogPlan.js';

export const SOURCE_PRICE_VERSION = 'pk361-standard-2026-09-10-v1';
const clientId = '00000000-0000-0000-1555-000000000000';
const same = (a,b) => catalogStableJson(a) === catalogStableJson(b);
const clone = value => structuredClone(value);
const scope = Object.freeze({
  // PK361 LimitationValues, rectangle / complete unit. Scope is intentionally
  // narrower than the complete catalog; nonstandard construction stays online.
  'catalog_262': { product:'Single Vent', series:'Studio', width:[20,96], height:[9,72], rows:[2853,2854,2855,2856] },
  'catalog_264': { product:'Single Hung', series:'Studio', width:[9,48], height:[23,96], rows:[2857,2858,2859,2860] },
  'catalog_270': { product:'Direct Set', series:'Studio', width:[8,120], height:[8,120], rows:[4761,4762,4763,4764] },
  'catalog_724': { product:'Casement', series:'Hampton', width:[17.5,36], height:[23.5,72], rows:[5059,5060,5061,5062] }
});
const keys = new Set(['series','fin','color','exterior_color','interior_color','glass','tempered','grilles','operation','unit_type','number_wide','sash_split',
  'patterned_glass','argon','elevation','super_spacer','glazing_method','hardware','hardware_color','screen','capillary_tubes']);
const decline = code => ({ok:false,code});
export function sourcePricingEnabled(config) { return config?.native_engine?.source_pricing === true && config.native_engine.catalog_id === '361'; }

// Computes fresh prices from imported rates. No observed-price matrix, browser,
// session or network request is used. A declined scope is never a zero price.
export function priceSourceWindow({line,settings}) {
  if (!line || Object.keys(line.options || {}).some(key=>!keys.has(key))) return decline('option_rules_required');
  if (settings?.dealer !== 'BFS' || settings.yard !== 'BFS-UTAH DESIGN(11)') return decline('account_not_qualified');
  const adjusted={...settings};
  if (adjusted.low_e === true && !adjusted.glass) adjusted.glass='CozE (LowE)';
  if (adjusted.low_e === false && !adjusted.glass) return decline('glass_rules_required');
  delete adjusted.low_e;
  const built=buildNativeCatalogPlan({id:'source-price',input_revision:1,settings:adjusted,lines:[line]});
  if (!built.ok) return decline('configuration_mapping_required');
  const p=built.plan.lines[0], selected=scope[p.product_profile_id], o=p.options;
  if (!selected || Object.keys(o).some(key=>!keys.has(key))) return decline('product_or_option_rules_required');
  const {width,height}=p.frame_dimensions;
  if (width<selected.width[0] || width>selected.width[1] || height<selected.height[0] || height>selected.height[1]) return decline('outside_catalog_size_limits');
  // Extra-large glass and custom sash geometry require the remaining glazing
  // rules. 36 ft² is a release-coverage boundary, not a manufacturer size limit.
  if (width*height>36*144) return decline('large_glass_rules_required');
  const standard={unit_type:'Complete Unit',number_wide:1,sash_split:'Even',patterned_glass:'None',argon:false,elevation:'2501 to 6500',
    super_spacer:true,capillary_tubes:false,hardware:selected.product==='Casement'?'Standard':'Cam Latch',hardware_color:o.interior_color,screen:o.interior_color};
  for(const [key,value] of Object.entries(standard)) if(o[key]!==undefined && o[key]!==value) return decline('nonstandard_'+key);
  // A direct-set window does not inherit operating-window hardware overrides.
  if(selected.product==='Direct Set' && ['hardware','hardware_color','screen','super_spacer'].some(key=>o[key]!==undefined)) return decline('fixed_construction_override');
  if(o.glazing_method!==undefined && !['3/4" Insulated','3/4 Insulated'].includes(o.glazing_method)) return decline('glazing_rules_required');
  const glass=o.glass==='CozE (Low-E)'?'CozE (LowE)':o.glass;
  if(glass!=='CozE (LowE)') return decline('glass_rules_required');
  let operation=o.operation || (selected.product==='Casement'?'Left':selected.product==='Single Vent'?'XO':selected.product==='Single Hung'?'Single Hung':'Fixed');
  if(selected.product==='Casement' && !['Left','Right'].includes(operation)) return decline('fixed_or_assembly_rules_required');
  if(selected.product==='Single Hung' && !['Single Hung','Operating'].includes(operation)) return decline('operation_rules_required');
  if(selected.product==='Single Hung') operation='Single Hung';
  let grille=0;
  if(o.grilles && o.grilles!=='None') {
    const g=o.grilles.match(/^5\/8" Flat · Rectangular · (2)W(2|4)H per lite · White$/);
    if(!g || o.interior_color!=='White' || width<22 || height<24) return decline('grille_rules_required');
    grille=1;
  }
  const tempered=o.tempered ?? false;
  // The initial live tempered path is the independently checked Hampton recipe.
  if(tempered && (selected.product!=='Casement' || width>36 || height>60)) return decline('tempered_rules_required');
  const configuration={series:selected.series,product_type:selected.product,unit_type:'Complete Unit',shape:'Rectangle',operation,tilted:false,
    width,height,dimension_basis:'frame',exterior_color:o.exterior_color,interior_color:o.interior_color,preserve:selected.series==='Hampton'?'Both':'None',
    grille_application_id:grille,glass,tempered,glazing_method:'3/4" Insulated',stock_glass:false,wildfire_glazing:'None',quantity:p.qty};
  const input={catalog_id:'361',price_book:1,client_id:clientId,gross_margin:settings.gross_margin,configuration};
  const calculated=calculateTransferredWindow(input);
  if(calculated.status!=='calculated') return decline(calculated.code);
  return {ok:true,version:SOURCE_PRICE_VERSION,plan_line:p,input,calculated,limitation_rows:selected.rows,
    defaults:{preserve:configuration.preserve,glazing_method:configuration.glazing_method,operation,tempered}};
}

export function sourcePricePreview(args) {
  const priced=priceSourceWindow(args);if(!priced.ok)return null;
  return {status:'priced',price_source:'amsco_source_engine',unit_prices:clone(priced.calculated.unit_prices),line_totals:clone(priced.calculated.line_totals),
    source_engine:{version:SOURCE_PRICE_VERSION,catalog_id:'361',price_book:1,status:'calculated',mode:'live',applied_defaults:priced.defaults},
    components:priced.calculated.components.map(c=>({name:c.name,value:c.value}))};
}

export function sourcePriceReceipt({line,settings,checkedAt}) {
  const priced=priceSourceWindow({line,settings});if(!priced.ok)return null;
  return {source:'amsco_source_engine',source_evidence:{version:SOURCE_PRICE_VERSION,catalog_id:'361',price_book:1,checked_at:checkedAt,
    selection:clone({line,settings}),input:priced.input,rate_source:priced.calculated.source,limitation_rows:priced.limitation_rows,
    components:clone(priced.calculated.components),defaults:priced.defaults},
    result:{lines:[{...clone(priced.plan_line),unit_prices:clone(priced.calculated.unit_prices)}],notices:[]}};
}

// Validate by recomputation, not by trusting a caller's amount or ready flag.
// Source receipts never pretend to be saved/reopened AMSCO online quotes.
export function sourcePriceEvidenceIssues(evidence,observed,requested,settings) {
  try {
    if(evidence?.source!=='amsco_source_engine' || evidence.version!==SOURCE_PRICE_VERSION || !same(evidence.selection,{line:requested,settings}) ||
      !Number.isFinite(Date.parse(evidence.checked_at))) return ['Source pricing must match the exact requested selection.'];
    const p=priceSourceWindow({line:requested,settings});
    if(!p.ok || evidence.catalog_id!=='361' || evidence.price_book!==1 || !same(evidence.input,p.input) || !same(evidence.rate_source,p.calculated.source) ||
      !same(evidence.components,p.calculated.components) || !same(evidence.limitation_rows,p.limitation_rows) || !same(evidence.defaults,p.defaults) ||
      !same(observed.unit_prices,p.calculated.unit_prices) || !same(observed.options,p.plan_line.options) || !same(observed.frame_dimensions,p.plan_line.frame_dimensions) ||
      observed.style!==p.plan_line.style || observed.product_profile_id!==p.plan_line.product_profile_id) return ['Source pricing could not be reproduced from the current AMSCO rules.'];
    return [];
  } catch { return ['Source pricing evidence is incomplete.']; }
}

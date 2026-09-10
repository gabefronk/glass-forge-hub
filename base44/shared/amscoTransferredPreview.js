import { calculateTransferredWindow } from './amscoTransferredEngine.js';
import { buildNativeCatalogPlan } from './nativeCatalogPlan.js';

const allowedOptions = new Set(['series','color','exterior_color','interior_color','glass','tempered','grilles','operation']);
const unavailable = code => ({ engine:'amsco_source_rules', mode:'comparison', status:'not_calculated', code, production_ready:false });

// The existing builder keeps its verified prices and totals. This independent
// calculation checks the same frame/finish selection and exposes differences for
// validation; a partially ported rule set never masquerades as a completed quote.
export function transferredPreviewComparison({ line, settings, observed }) {
  if (!line || Object.keys(line.options || {}).some(k => !allowedOptions.has(k))) return unavailable('additional_option_rules_required');
  const adjusted = { ...settings };
  if (adjusted.low_e === true && !adjusted.glass) adjusted.glass = 'CozE (LowE)';
  if (adjusted.low_e === false && !adjusted.glass) return unavailable('glass_rules_required');
  delete adjusted.low_e;
  const built = buildNativeCatalogPlan({ id:'source-engine-comparison', input_revision:1, settings:adjusted, lines:[line] });
  if (!built.ok) return unavailable('configuration_mapping_required');
  const p = built.plan.lines[0], o = p.options, defaults = [];
  if (Object.keys(o).some(k => !allowedOptions.has(k))) return unavailable('additional_option_rules_required');
  const studio = o.series.startsWith('Studio');
  let product, operation;
  if (/Single Hung$/.test(p.style)) { product='Single Hung';operation='Single Hung'; }
  else if (/XO Slider$|Single Vent$/.test(p.style)) { product='Single Vent';operation=o.operation || 'XO'; }
  else if (/Picture$|Direct Set$/.test(p.style)) { product='Direct Set';operation='Fixed'; }
  else if (/Casement$/.test(p.style)) { product=o.operation==='Fixed'?'Fixed Casement':'Casement';operation=o.operation || 'Left'; }
  else return unavailable('product_rules_required');
  if (!o.operation && ['Casement','Single Vent'].includes(product)) defaults.push({option:'operation',value:operation});
  let grille = 0;
  if (o.grilles && o.grilles !== 'None') {
    if (!/^5\/8" Flat · Rectangular · ([1-9]|1[0-2])W([1-9]|1[0-2])H per lite · White$/.test(o.grilles)) return unavailable('grille_rules_required');
    grille=1;
  }
  // These are the standard source-control recipes. Omitted defaults remain
  // visible in the comparison audit until configuration filtering is ported.
  const preserve = studio ? 'None' : 'Both';
  defaults.push({option:'preserve',value:preserve});
  if (o.tempered === undefined) defaults.push({option:'tempered',value:false});
  const calculated=calculateTransferredWindow({catalog_id:'361',price_book:1,configuration:{
    series:studio ? o.series.replace('Studio 1 3/8 inch Fin Setback','Studio').replace('Studio Stucco Key Windows','Studio SK') : o.series,
    product_type:product,unit_type:'Complete Unit',shape:'Rectangle',operation,tilted:false,width:p.frame_dimensions.width,height:p.frame_dimensions.height,dimension_basis:'frame',
    exterior_color:o.exterior_color,interior_color:o.interior_color,glass:o.glass==='CozE (Low-E)'?'CozE (LowE)':o.glass,tempered:o.tempered ?? false,preserve,grille_application_id:grille,quantity:p.qty
  }});
  if (calculated.status!=='calculated') return unavailable(calculated.code);
  const actual=observed?.unit_prices?.list;
  const delta=typeof actual==='number' && Number.isFinite(actual) ? Math.round((calculated.unit_prices.list-actual)*100)/100 : null;
  return {engine:'amsco_source_rules',mode:'comparison',status:delta===null?'awaiting_verified_price':delta===0?'matches_verified_price':'price_difference',production_ready:false,
    catalog_id:'361',price_book:1,calculated_list:calculated.unit_prices.list,verified_list:delta===null?null:actual,difference:delta,applied_defaults:defaults,
    base_rule:calculated.base_selection.rule_id,components:calculated.components.map(c=>({name:c.name,value:c.value,rule_ids:c.rule_ids}))};
}

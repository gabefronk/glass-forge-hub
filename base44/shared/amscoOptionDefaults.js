import { catalogRouteForLine } from './nativeCatalogPlan.js';
import { sourceGlassConstruction } from './amscoGlassConstruction.js';

// Display-only starting selections. Never copy these into requested options:
// omitted fields must continue to follow the native catalog when size changes.
// Studio/V2K recipes: saved native controls. Hampton: saved preview proof.
// Serenity spacer/glazing/capillary defaults: Navigator, 2026-09-11.
const present = value => value !== undefined && value !== null && value !== '';

// Additional operation branches visible in Navigator. These share the family's
// basic selections, but their shaped/mulled glass stays native-resolved.
function displayRoute(line, settings) {
  const route = catalogRouteForLine(line,settings);
  if (route) return {...route,rectangular:true};
  const series = line.options?.series || settings.series || (/^Hampton /.test(line.style || '') ? 'Hampton' : /^Studio /.test(line.style || '') ? 'Studio 1 3/8 inch Fin Setback' : '');
  const brand = /^Hampton(?: SK| Flush Fin)?$/.test(series) ? 'Hampton'
    : /^Studio (?:1 3\/8 inch Fin Setback|Stucco Key Windows|SK3|Flush Fin)$/.test(series) ? 'Studio' : null;
  if (!brand || !String(line.style || '').startsWith(brand+' ')) return null;
  const label = line.style.slice(brand.length+1);
  if (label === 'Single Hung Geometrics') return {series,brand,kind:'single_hung',label,rectangular:false};
  if (['Slider PW (Standalone)','Equal Lite PW','PW Only Direct Set Continuous Frame','Equal Lite Direct Set','Sash Set Slider Frame','Radius','Polygon'].includes(label))
    return {series,brand,kind:'direct_set',label,rectangular:false};
  return null;
}

export function catalogOptionDefaults(line = {}, settings = {}) {
  const route = displayRoute(line, settings);
  if (!route) return {};
  const raw = {...settings, ...line.options};
  const color = raw.color || 'White';
  const pair = String(color).match(/^(.*?)\s+exterior\s*\/\s*(.*?)\s+interior$/i);
  const interior = raw.interior_color || pair?.[2] || color;
  const exterior = raw.exterior_color || pair?.[1] || color;
  const operating = route.kind !== 'direct_set' && raw.operation !== 'Fixed';
  const crank = ['casement', 'awning'].includes(route.kind);
  const defaults = {
    series: route.series, exterior_color: exterior, interior_color: interior,
    unit_type: 'Complete Unit', number_wide: 1, tempered: false,
    glass: settings.low_e === false ? undefined : 'CozE (LowE)',
    patterned_glass: 'None', argon: false, elevation: '2501 to 6500',
    super_spacer: ['Hampton', 'Serenity'].includes(route.brand),
    glazing_method: '3/4" Insulated', capillary_tubes: false, grilles: 'None',
    operation: {single_vent:'XO', double_vent:'XOX', single_hung:'Single Hung', direct_set:'Fixed', casement:'Left', awning:'Operating'}[route.kind],
    ...(route.kind === 'single_hung' ? {sash_split:'Even'} : {}),
    ...(operating ? {hardware: crank ? 'Standard' : 'Cam Latch', hardware_color:interior, screen:interior} : {})
  };
  // Elevation affects breather tubes; another altitude remains native-resolved.
  if (present(raw.elevation) && raw.elevation !== defaults.elevation) delete defaults.capillary_tubes;
  const selected = {...defaults,...Object.fromEntries(Object.entries(raw).filter(([,v])=>present(v)))};
  const frame = catalogFrameSize(line, route);
  const construction = frame && route.rectangular && Number(selected.number_wide) === 1 && !line.shape && !line.components && !line.mulls
    ? sourceGlassConstruction({series:route.brand,product_type:route.label,shape:'Rectangle',
        unit_type:selected.unit_type,dimension_basis:'frame',...frame,operation:selected.operation === 'Operating' && route.kind === 'single_hung' ? 'Single Hung' : selected.operation,
        glass:String(selected.glass).replace('Low-E','LowE'),tempered:selected.tempered,tilted:false,
        glazing_method:String(selected.glazing_method).replace('3/4 inch Insulated Glass','3/4" Insulated').replace(/^3\/4 Insulated$/,'3/4" Insulated')})
    : null;
  return {...defaults,...(construction ? {glass_thickness:construction.glass_thickness,glass_panes:construction.panes} : {})};
}
export function catalogFrameSize(line = {}, route = catalogRouteForLine(line)) {
  const width = Number(line.width), height = Number(line.height);
  if (!route || !(width > 0 && height > 0) || Number(line.options?.number_wide || 1) !== 1 || line.units && line.units !== 'in') return null;
  if (line.dimension_basis === 'frame') return {width,height};
  if (line.dimension_basis === 'call' && ['Studio 1 3/8 inch Fin Setback','Studio Flush Fin'].includes(route.series) &&
      ['single_vent','single_hung','direct_set'].includes(route.kind) && width > .5 && height > .5) return {width:width-.5,height:height-.5};
  return null;
}

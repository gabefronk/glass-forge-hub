// Shared catalog plan for native calculation. A route permits a native attempt;
// only a matching saved/reopened observation can produce a verified price.
export const CATALOG_SUPPORT_ID = 'amsco-pk361-catalog-v1';
export const CATALOG_PLAN_VERSION = 3;
export const CATALOG_ROUTES = Object.freeze([
  ['Hampton', 'Hampton', [714,715,716,723,724,725]],
  ['Hampton SK', 'Hampton', [726,727,728,735,736,737]],
  ['Hampton Flush Fin', 'Hampton', [738,739,740,747,748,749]],
  ['Studio 1 3/8 inch Fin Setback', 'Studio', [262,263,264,270]],
  ['Studio Stucco Key Windows', 'Studio', [293,294,295,301]],
  ['Studio SK3', 'Studio', [355,356,357,363]],
  ['Studio Flush Fin', 'Studio', [324,325,326,332]],
  ['Serenity', 'Serenity', [501,502,503,506,504,505]],
  ['V2K BW', 'V2K BW', [493,494,495,496]]
].flatMap(([series,brand,ids]) => ids.map((id,index) => {
  const kind = ['single_vent','double_vent','single_hung','direct_set','casement','awning'][index];
  const label = ['Single Vent','Double Vent','Single Hung','Direct Set','Casement','Awning'][index];
  const style = brand === 'Studio' && index === 0 ? 'Studio XO Slider' : brand === 'Studio' && index === 3 ? 'Studio Picture' : brand + ' ' + label;
  return Object.freeze({ id: 'catalog_' + id, windowset_id: id, series, brand, kind, style, label });
})));
const norm = value => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/g,'') : '';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && value !== '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => JSON.parse(JSON.stringify(value));
export const catalogStableJson = value => JSON.stringify(value, (_key,item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const has = (value,key) => Object.hasOwn(value,key) && present(value[key]);
const add = (issues,code,path,message) => issues.push({code,path,message});
const text = value => typeof value === 'string' ? value.trim() : '';
const fail = issues => ({ok:false,status:'needs_details',issues,questions:[...new Set(issues.map(i => i.message))]});
const OPTION_NAMES = Object.freeze({
  unit_type:'Unit Type', operation:'Operation / Venting', exterior_color:'Exterior Color', interior_color:'Interior Color',
  glass:'Glass Type', glazing_method:'Glazing Method', tempered:'Tempered', patterned_glass:'Patterned Glass', glass_thickness:'Glass Thickness',
  argon:'Thermal Gas Added', elevation:'Window Installation Elevation (Ft Above Sea Level)', hardware:'Hardware Type',
  hardware_color:'Hardware Finish', screen:'Screen', super_spacer:'Super Spacer', capillary_tubes:'Breather Tubes'
});
const BOOL = new Set(['tempered','argon','super_spacer','capillary_tubes']);
const VALUE_ALIASES = {'CozE (Low-E)':'CozE (LowE)', '3/4 inch Insulated Glass':'3/4" Insulated', '1 inch Insulated Glass':'1" Insulated',
  '3/16 inch over 3/16 inch':'3/16" over 3/16"', '1/4 inch over 1/4 inch':'1/4" over 1/4"'};
const OPTION_KEYS = new Set([...Object.keys(OPTION_NAMES),'series','fin','color','grilles','number_wide','sash_split']);
const FINANCE_KEYS = new Set(['dealer','yard','gross_margin','markup','markup_percent','flat_markup','customer_price_override','tax','labor','freight','delivery']);
export function catalogRouteForLine(line,settings={}) {
  const style = norm(line?.style), given = line?.options?.series || settings.series;
  const specialSeries = [...new Set(CATALOG_ROUTES.map(r=>r.series))].filter(s=>/Flush Fin|Stucco Key| SK|SK3/.test(s)).sort((a,b)=>b.length-a.length).find(s=>style.startsWith(norm(s)));
  let series = given ? CATALOG_ROUTES.find(r => norm(r.series) === norm(given))?.series : specialSeries;
  if (specialSeries && given && norm(given)!==norm(specialSeries)) return null;
  if (/doublecasement|twincasement|triplecasement/.test(style)) return null;
  if (given && !series) return null;
  let brand = ['Hampton','Studio','Serenity','V2K BW'].find(b => style.startsWith(norm(b)));
  if (!brand && !['singlehung','sh','slider','xoslider','singlevent','doublevent','picture','directset'].includes(style)) return null;
  if (!series) series = brand === 'Hampton' ? 'Hampton' : brand === 'Serenity' ? 'Serenity' : brand === 'V2K BW' ? 'V2K BW' : 'Studio 1 3/8 inch Fin Setback';
  const candidates = CATALOG_ROUTES.filter(r => r.series === series);
  if (brand && candidates[0]?.brand !== brand) return null;
  const kind = /doublevent$/.test(style) ? 'double_vent' : /singlehung$|^sh$/.test(style) ? 'single_hung' :
    /picture$|directset$/.test(style) ? 'direct_set' : /casement$/.test(style) ? 'casement' :
    /awning$/.test(style) ? 'awning' : /slider$|singlevent$/.test(style) ? 'single_vent' : null;
  return candidates.find(r => r.kind === kind) || null;
}
function colors(raw,settings,issues,path) {
  const source = ['color','exterior_color','interior_color'].some(key => has(raw,key)) ? raw : settings;
  const known = {white:['White','White'],whitewhite:['White','White'],whitebothsides:['White','White'],
    black:['Black','Black'],blackblack:['Black','Black'],blackbothsides:['Black','Black'],
    blackexteriorblackinterior:['Black','Black'],blackoutsideblackinside:['Black','Black'],
    blackwhite:['Black','White'],blackexteriorwhiteinterior:['Black','White'],blackoutsidewhiteinside:['Black','White'],
    taupe:['Taupe','Taupe'],taupetaupe:['Taupe','Taupe']};
  let pair = known[norm(source.color)];
  if (has(source,'color') && !pair) add(issues,'unsupported_colors',path+'.color','The requested finish needs AMSCO configuration.');
  if (has(source,'exterior_color') || has(source,'interior_color')) {
    const sides = [source.exterior_color,source.interior_color].map(v => ['White','Black','Taupe'].find(c => norm(c) === norm(v)));
    if (sides.some(v => !v) || pair && pair.some((v,i) => v !== sides[i])) add(issues,'conflicting_colors',path+'.color','Specify one consistent exterior and interior color pair.');
    else pair = sides;
  }
  if (!pair) add(issues,'missing_option',path+'.color','Choose exterior and interior colors.');
  return pair ? {color:pair[0] === pair[1] ? pair[0] : pair[0]+' exterior / '+pair[1]+' interior', exterior_color:pair[0],interior_color:pair[1]} : {};
}
function optionPlan(line,settings,route,issues,path) {
  const raw = object(line.options) ? line.options : {}, options = {series:route.series,...colors(raw,settings,issues,path)}, questions=[];
  for (const key of Object.keys(raw)) if (!OPTION_KEYS.has(key)) add(issues,'unsupported_option',path+'.'+key,'The requested '+key+' needs AMSCO configuration.');
  // Legacy/imported schedules express standard Studio installation as a fin.
  // Accept only an exact compatible alias; never discard a conflicting choice.
  const fin = has(raw,'fin') ? raw.fin : has(raw,'series') ? undefined : settings.fin;
  const standardStudioFin = route.series === 'Studio 1 3/8 inch Fin Setback' &&
    ['nailfin','nailingfin','regularnailfin','standardnailfin','138finsetback','138inchfinsetback'].includes(norm(fin));
  if (present(fin) && !standardStudioFin) add(issues,'unsupported_option',path+'.fin','Choose a compatible installation series for the requested fin.');
  if (has(raw,'number_wide') && raw.number_wide !== 1) add(issues,'unsupported_assembly',path+'.number_wide','This assembly needs AMSCO configuration.');
  if (has(raw,'sash_split') && raw.sash_split !== 'Even') add(issues,'unsupported_option',path+'.sash_split','This sash split needs AMSCO configuration.');
  // Do not inject a Studio recipe into another product. Only explicit choices
  // and inherited job choices become native changes; other choices stay native.
  for (const [key,name] of Object.entries(OPTION_NAMES)) {
    const value = has(options,key) ? options[key] : has(raw,key) ? raw[key] : has(settings,key) ? settings[key] : undefined;
    if (!present(value)) continue;
    if (BOOL.has(key) && typeof value !== 'boolean' || !BOOL.has(key) && (typeof value !== 'string' || !value.trim() || value.length > 256)) {
      add(issues,'invalid_option',path+'.'+key,'The requested '+key+' must have a valid typed selection.');continue;
    }
    options[key] = value;
    let nativeValue = BOOL.has(key) ? key === 'argon' ? value ? 'Argon' : 'None' : value ? 'Yes' : 'No' : VALUE_ALIASES[value] || value;
    if (key === 'screen' && ['White','Black','Taupe'].includes(value)) {
      if (value !== options.interior_color) add(issues,'unsupported_option',path+'.screen','A screen finish different from the interior needs AMSCO configuration.');
      nativeValue = 'Yes';
    }
    questions.push({name,value:nativeValue});
  }
  if (has(raw,'number_wide')) options.number_wide = raw.number_wide;
  if (has(raw,'sash_split')) {
    // Native Sash Split is not currently applied by the fixed frame entry API.
    // Omitting it is safe only where the requested even split is separately observed.
    options.sash_split=raw.sash_split;
  }
  const grille = has(raw,'grilles') ? raw.grilles : settings.grilles;
  if (present(grille)) {
    options.grilles=grille;
    if (grille === 'None') questions.push({name:'Grille Type',value:'None'});
    else {
      const match = typeof grille === 'string' && grille.match(/^(5\/8" Flat) · Rectangular · (\d+)W(\d+)H per lite · (White|Black|Taupe)$/);
      if (!match || ![Number(match[2]),Number(match[3])].every(n=>n>=1&&n<=12)) add(issues,'unsupported_grilles',path+'.grilles','This grille specification needs AMSCO configuration.');
      else {
        questions.push({name:'Grille Type',value:match[1]},{name:'Grille Pattern',value:'Rectangular'},
          {name:'Grille Color',value:match[4]},{name:'Grille Division Type',value:'Custom'},
          {name:'Number Wide',value:match[2]},{name:'Number High',value:match[3]});
      }
    }
  }
  return {options,native_questions:questions};
}
export function buildNativeCatalogPlan(quote) {
  const issues=[], settings=object(quote?.settings)?quote.settings:{};
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(quote?.id||'')) add(issues,'missing_identity','id','A saved request is required.');
  if (!Number.isSafeInteger(quote?.input_revision)||quote.input_revision<1) add(issues,'missing_revision','input_revision','A saved request revision is required.');
  if (settings.dealer !== 'BFS') add(issues,'unsupported_dealer','settings.dealer','This engine uses the BFS account.');
  if (!text(settings.yard)||/please\s*select|unassigned|not\s*sure/i.test(settings.yard)) add(issues,'missing_finance','settings.yard','Choose a BFS shipping yard.');
  if (!finite(settings.gross_margin)||settings.gross_margin<0||settings.gross_margin>=100) add(issues,'missing_finance','settings.gross_margin','Choose a valid gross margin.');
  for (const key of Object.keys(settings)) {
    if (!OPTION_KEYS.has(key)&&!FINANCE_KEYS.has(key)) add(issues,'unsupported_setting','settings.'+key,'The supplied setting needs AMSCO configuration.');
    if (['markup','markup_percent','flat_markup','customer_price_override'].includes(key)&&present(settings[key]) ||
        ['tax','labor','freight','delivery'].includes(key)&&present(settings[key])&&settings[key]!==0) add(issues,'unsupported_pricing','settings.'+key,'This calculation supports windows-only pretax gross-margin pricing.');
  }
  if (text(quote?.title).length>200) add(issues,'invalid_title','title','The quote title is too long.');
  if (!Array.isArray(quote?.lines)||quote.lines.length<1||quote.lines.length>100) return fail([...issues,{code:'invalid_lines',path:'lines',message:'Provide 1–100 window lines.'}]);
  const lines=quote.lines.map((line,index)=>{
    const path='lines['+index+']', route=catalogRouteForLine(line,settings);
    if (!object(line)||!route) {add(issues,'unsupported_product',path+'.style','This product needs AMSCO configuration.');return null;}
    if (line.units!=='in'||![line.width,line.height].every(n=>finite(n)&&n>0&&n<=1000)) add(issues,'invalid_dimensions',path,'Provide positive inch dimensions.');
    if (!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>1000) add(issues,'invalid_quantity',path+'.qty','Provide a whole-number quantity.');
    if (text(line.room).length>200) add(issues,'invalid_room',path+'.room','The room label is too long.');
    if (['components','mulls','shape'].some(key=>has(line,key))) add(issues,'unsupported_assembly',path,'This assembly needs AMSCO configuration.');
    let frame;
    if (line.dimension_basis==='frame') frame={width:line.width,height:line.height,units:'in'};
    else if (line.dimension_basis==='call'&&['Studio 1 3/8 inch Fin Setback','Studio Flush Fin'].includes(route.series)&&
      ['single_vent','single_hung','direct_set'].includes(route.kind)) frame={width:line.width-0.5,height:line.height-0.5,units:'in'};
    else add(issues,'unsupported_dimensions',path+'.dimension_basis','This measurement basis needs AMSCO configuration for the selected product.');
    if (frame&&![frame.width,frame.height].every(n=>finite(n)&&n>0)) add(issues,'invalid_dimensions',path,'The calculated frame size must be positive.');
    const selected=optionPlan(line,settings,route,issues,path+'.options');
    return {source_index:index,room:text(line.room),qty:line.qty,width:line.width,height:line.height,units:'in',dimension_basis:line.dimension_basis,
      style:route.style,frame_dimensions:frame,product_profile_id:route.id,native_windowset_id:route.windowset_id,...selected};
  });
  if (issues.length) return fail(issues);
  return {ok:true,plan:{schema_version:CATALOG_PLAN_VERSION,support_id:CATALOG_SUPPORT_ID,catalog_id:'361',quote_id:quote.id,
    input_revision:quote.input_revision,title:text(quote.title),pricing_scope:'windows_only_pretax',
    settings:{dealer:'BFS',yard:text(settings.yard),gross_margin:settings.gross_margin},lines}};
}
export function assertNativeCatalogPlan(plan) {
  if (plan?.schema_version!==CATALOG_PLAN_VERSION||plan.support_id!==CATALOG_SUPPORT_ID||plan.catalog_id!=='361') return fail([{code:'catalog_contract_mismatch',path:'plan',message:'The native catalog contract differs.'}]);
  const rebuilt=buildNativeCatalogPlan({id:plan.quote_id,input_revision:plan.input_revision,title:plan.title,settings:plan.settings,lines:plan.lines});
  if (!rebuilt.ok||catalogStableJson(rebuilt.plan)!==catalogStableJson(plan)) return fail([{code:'invalid_plan',path:'plan',message:'The native plan does not match its immutable requested options.'}]);
  return rebuilt;
}

export async function catalogPlanHash(plan) {
  const hash=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(catalogStableJson(plan)));
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const xmlValue=value=>{
  const string=String(value);
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(string))throw Error('Unsupported XML control character.');
  return string.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replaceAll('\r','&#13;').replaceAll('\n','&#10;').replaceAll('\t','&#9;');
};
export async function buildCatalogWindowPackage(plan,{planHash}={}) {
  const checked=assertNativeCatalogPlan(plan);
  if(!checked.ok||await catalogPlanHash(plan)!==planHash)throw Error('The native catalog plan and hash must match.');
  const attrs=values=>Object.entries(values).map(([key,value])=>key+'="'+xmlValue(value)+'"').join(' ');
  const root={version:'1',requestId:plan.quote_id,inputRevision:plan.input_revision,planHash,brandID:'1',pkVersion:'361',
    grossMargin:plan.settings.gross_margin,pricingScope:plan.pricing_scope,title:plan.title};
  const lines=plan.lines.map((line,index)=>{
    const attributes={id:'line-'+(index+1),sourceIndex:index,line:(index+1)*100,family:line.product_profile_id,
      windowsetID:line.native_windowset_id,buildMode:'frame',width:line.frame_dimensions.width,height:line.frame_dimensions.height,
      quantity:line.qty,room:line.room,dimensionBasis:'frame',requestedBasis:line.dimension_basis,requestedWidth:line.width,requestedHeight:line.height};
    return {attributes,options:clone(line.native_questions)};
  });
  const xml='<WindowPackage '+attrs(root)+'>\n'+lines.map(line=>'  <WindowRequest '+attrs(line.attributes)+'>\n'+
    line.options.map(option=>'    <Option '+attrs(option)+' />').join('\n')+'\n  </WindowRequest>').join('\n')+'\n</WindowPackage>\n';
  return {xml,request:{attributes:root,lines},account_expectations:clone(plan.settings)};
}

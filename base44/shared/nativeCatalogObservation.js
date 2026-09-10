import { assertNativeCatalogPlan, CATALOG_SUPPORT_ID, CATALOG_ROUTES, catalogStableJson } from './nativeCatalogPlan.js';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const close = (a,b) => finite(a)&&finite(b)&&Math.abs(a-b)<0.000001;
const cents = value => finite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))&&Math.abs(value*100-Math.round(value*100))<0.000001 ? Math.round(value*100) : null;
const stable = catalogStableJson;
export function verifyCatalogObservedQuote(plan,observed,{validateIdentity}={}) {
  const rebuilt=assertNativeCatalogPlan(plan); if(!rebuilt.ok)return{...rebuilt,status:'failed'};
  const issues=[], reject=(code,path,message)=>issues.push({code,path,message});
  if(observed?.native_source!=='desktop_native'||observed.reopened!==true)reject('not_reopened','observed','A saved and independently reopened desktop observation is required.');
  if(observed?.quote_id!==plan.quote_id||observed.input_revision!==plan.input_revision)reject('request_mismatch','quote_id','The observed revision differs.');
  if(typeof validateIdentity!=='function')reject('identity_verifier_missing','native_quote_id','The native persistence verifier is required.');
  else issues.push(...validateIdentity(observed));
  if(observed?.dealer!=='BFS'||observed.yard!==plan.settings.yard||!close(observed.gross_margin,plan.settings.gross_margin))reject('account_mismatch','settings','The observed account, yard or margin differs.');
  if(!Array.isArray(observed?.lines)||observed.lines.length!==plan.lines.length)reject('line_count_mismatch','lines','The observed line count differs.');
  const ids=new Set(),numbers=new Set(),sums={list:0,dealer:0,customer:0},resultLines=[];
  for(let i=0;i<plan.lines.length;i++){
    const expected=plan.lines[i], actual=observed?.lines?.[i], path='lines['+i+']';
    if(!actual){reject('missing_line',path,'The observed line is missing.');continue;}
    if(!/^[A-Za-z0-9_-]{1,160}$/.test(actual.native_line_id||'')||ids.has(actual.native_line_id))reject('line_identity_invalid',path,'Native line IDs must be unique.');
    ids.add(actual.native_line_id);
    const number=String(actual.native_line_number);
    if(!/^[1-9]\d*$/.test(number)||numbers.has(number))reject('line_number_invalid',path,'Native line numbers must be unique.');
    numbers.add(number);
    if(actual.qty!==expected.qty||actual.room!==expected.room)reject('line_mismatch',path,'The quantity or room differs.');
    if(actual.style!==expected.style||actual.product_profile_id!==expected.product_profile_id||
      actual.options?.native_geometry?.windowset_id!==expected.native_windowset_id)reject('product_mismatch',path,'The saved native catalog route differs.');
    if(actual.units!=='in'||actual.dimension_basis!=='frame'||!close(actual.width,expected.frame_dimensions.width)||!close(actual.height,expected.frame_dimensions.height)||
      !close(actual.frame_dimensions?.width,expected.frame_dimensions.width)||!close(actual.frame_dimensions?.height,expected.frame_dimensions.height)||actual.frame_dimensions?.units!=='in')reject('dimension_mismatch',path,'The saved native frame dimensions differ.');
    if(actual.options?.native_geometry?.number_wide!==1)reject('assembly_mismatch',path,'The saved native layout is not one wide.');
    if(expected.options.sash_split&&actual.options?.native_geometry?.sash_split!==expected.options.sash_split)reject('sash_split_mismatch',path,'The saved sash split differs.');
    const answers=actual.options?.native_answers,grilles=actual.options?.native_grilles;
    for(const wanted of expected.native_questions){
      if(['Grille Division Type','Number Wide','Number High'].includes(wanted.name)){
        if(!Array.isArray(grilles)||!grilles.length)reject('grille_missing',path,'Per-lite grille evidence is missing.');
        else for(const glass of grilles){
          const value=glass[wanted.name];
          if(value!==wanted.value&&!(wanted.name==='Grille Division Type'&&wanted.value==='Custom'&&value==='Typical'))reject('grille_mismatch',path,'The saved per-lite grille differs.');
        }
      }else if(answers?.[wanted.name]!==wanted.value)reject('option_mismatch',path+'.'+wanted.name,'The saved native option differs: '+wanted.name+'.');
    }
    // Public display values must be grounded in the same observed evidence used
    // for verification, rather than copied from the request.
    try {
      const derived=catalogOptionsFromNative({windowset_id:actual.options?.native_geometry?.windowset_id,questions:answers,
        grilles,number_wide:actual.options?.native_geometry?.number_wide,sash_split:actual.options?.native_geometry?.sash_split});
      if(stable(derived)!==stable(actual.options))reject('display_option_mismatch',path+'.options','Displayed selections differ from native answers.');
    } catch {reject('display_option_mismatch',path+'.options','Displayed selections lack valid native evidence.');}
    if(!finite(actual.gross_margin)||Math.abs(actual.gross_margin-plan.settings.gross_margin)>0.0001)reject('margin_mismatch',path,'The saved line margin differs.');
    const unit={},extended={};
    for(const kind of ['list','dealer','customer']){
      unit[kind]=cents(actual.unit_prices?.[kind]);extended[kind]=cents(actual.line_totals?.[kind]);
      if(unit[kind]===null||unit[kind]<=0||extended[kind]!==unit[kind]*expected.qty)reject('price_mismatch',path+'.'+kind,'Positive native unit cents and exact extensions are required.');
      else sums[kind]+=extended[kind];
    }
    if(unit.dealer!==null&&unit.customer!==null&&Math.abs(unit.customer-Math.round(unit.dealer/(1-plan.settings.gross_margin/100)))>1)reject('customer_margin_mismatch',path,'Native customer pricing differs from the requested margin.');
    const {native_answers,native_grilles,native_geometry,...display}=actual.options||{};
    resultLines.push({...expected,options:display,native_line_id:actual.native_line_id,native_line_number:number,unit_prices:actual.unit_prices,line_totals:actual.line_totals,gross_margin:actual.gross_margin});
  }
  if(observed?.totals?.currency!=='USD')reject('currency_mismatch','totals','USD totals are required.');
  for(const [field,kind] of [['list_total','list'],['dealer_cost','dealer'],['customer_total','customer']])
    if(cents(observed?.totals?.[field])!==sums[kind])reject('total_mismatch','totals.'+field,'The total differs from native line extensions.');
  for(const field of ['tax','freight','labor'])if(observed?.totals?.[field]!==0)reject('unexpected_charge','totals.'+field,'A windows-only pretax observation must have zero '+field+'.');
  if(observed?.totals?.total!==undefined&&cents(observed.totals.total)!==sums.customer)reject('total_mismatch','totals.total','The total alias differs.');
  if(issues.length)return{ok:false,status:'failed',issues};
  return{ok:true,result:{verified:true,quote_id:plan.quote_id,input_revision:plan.input_revision,native_source:'desktop_native',
    native_quote_id:observed.native_quote_id,dealer:observed.dealer,yard:observed.yard,pricing_scope:plan.pricing_scope,
    lines:resultLines,totals:{...observed.totals,gross_margin:plan.settings.gross_margin},
    verification:{support_id:CATALOG_SUPPORT_ID,catalog_id:plan.catalog_id,reopened:true,checked_at:observed.checked_at}}};
}
export function catalogOptionsFromNative(raw) {
  const route=CATALOG_ROUTES.find(r=>r.windowset_id===raw.windowset_id);if(!route)throw Error('Unknown native catalog route.');
  const q=raw.questions||{},bool=value=>value==='Yes'?true:value==='No'?false:undefined;
  const options={series:route.series,exterior_color:q['Exterior Color'],interior_color:q['Interior Color'],
    color:q['Exterior Color']===q['Interior Color']?q['Exterior Color']:q['Exterior Color']+' exterior / '+q['Interior Color']+' interior'};
  const fields={unit_type:'Unit Type',operation:'Operation / Venting',glass:'Glass Type',glazing_method:'Glazing Method',
    patterned_glass:'Patterned Glass',glass_thickness:'Glass Thickness',elevation:'Window Installation Elevation (Ft Above Sea Level)',
    hardware:'Hardware Type',hardware_color:'Hardware Finish'};
  for(const [key,name] of Object.entries(fields))if(q[name])options[key]=q[name];
  for(const [key,name] of Object.entries({tempered:'Tempered',super_spacer:'Super Spacer',capillary_tubes:'Breather Tubes'}))if(bool(q[name])!==undefined)options[key]=bool(q[name]);
  if(q['Thermal Gas Added'])options.argon=q['Thermal Gas Added']==='None'?false:q['Thermal Gas Added']==='Argon'?true:q['Thermal Gas Added'];
  if(q.Screen)options.screen=q.Screen==='Yes'?q['Interior Color']:q.Screen;
  if(q['Grille Type']==='None')options.grilles='None';
  else if(q['Grille Type']&&q['Grille Pattern']==='Rectangular'&&raw.grilles?.length&&
    raw.grilles.every(g=>g['Number Wide']===raw.grilles[0]['Number Wide']&&g['Number High']===raw.grilles[0]['Number High'])){
    options.grilles=q['Grille Type']+' · Rectangular · '+raw.grilles[0]['Number Wide']+'W'+raw.grilles[0]['Number High']+'H per lite · '+q['Grille Color'];
  }
  return {...options,native_answers:q,native_grilles:raw.grilles||[],native_geometry:{windowset_id:raw.windowset_id,number_wide:raw.number_wide,sash_split:raw.sash_split||''}};
}
export function catalogStagesMatch(stages) {return stable(stages.before_save)===stable(stages.after_save)&&stable(stages.after_save)===stable(stages.reopened);}

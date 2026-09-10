// Display values only. Never write resolved defaults into the requested options:
// an omitted thickness must stay automatic when dimensions change.
const has = value => value !== undefined && value !== null && value !== "";
const fields = new Set(["series","fin","color","exterior_color","interior_color","glass","tempered","patterned_glass","screen","hardware","hardware_color","glass_thickness","glazing_method","elevation","argon","super_spacer","capillary_tubes","grilles","operation","sash_split","number_wide","unit_type"]);
const pick = source => Object.fromEntries(Object.entries(source || {}).filter(([key,value]) => fields.has(key) && has(value)));

export const GLASS_THICKNESS_CHOICES = [
  {value:"SS over SS",label:"Single-strength over single-strength (SS/SS)"},
  {value:"DS over DS",label:"Double-strength over double-strength (DS/DS)"},
  {value:'3/16" over 3/16"',label:"3/16″ over 3/16″"},
  {value:'1/4" over 1/4"',label:"1/4″ over 1/4″"}
];
export function specificationValue(key,value) {
  if (!has(value)) return "";
  if (key === "tempered") return value === true || value === "true" ? "Tempered glass" : value === false || value === "false" ? "Non-tempered glass" : String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "glass_thickness") {
    const normalized = String(value).replaceAll(" inch",'"');
    return GLASS_THICKNESS_CHOICES.find(choice => choice.value === normalized)?.label ||
      (value === "SS" ? "Single-strength (SS; pane construction unspecified)" : value === "DS" ? "Double-strength (DS; pane construction unspecified)" : normalized.replaceAll('"',"″"));
  }
  if (key === "glazing_method") return String(value).replace(/^(3\/4|1)(?: inch Insulated Glass|" Insulated| Insulated)$/, "$1″ insulated glass unit");
  return String(value);
}
export function resolvedWindowOptions(line = {},settings = {},price) {
  const inherited = pick(settings);
  if (!has(inherited.glass) && settings.low_e === true) inherited.glass = "CozE (LowE)";
  return {...inherited,...pick(line.options),...(price?.status === "priced" ? pick(price.resolved_options) : {})};
}
export function automaticOptionLabel(key,line = {},settings = {},price,priceStatus) {
  // An explicit override's current result is not the default that resetting it
  // will select. Let the next calculation resolve the reset instead.
  if (has(line.options?.[key])) return has(settings[key]) ? specificationValue(key,settings[key]) + " (quote default)" : "Recalculate automatic selection";
  const value = resolvedWindowOptions(line,settings,price)[key];
  if (has(value)) return specificationValue(key,value) + (has(settings[key]) ? " (quote default)" : " (automatic)");
  if (!Number(line.width) || !Number(line.height)) return "Enter size to resolve specification";
  if (priceStatus === "loading" || ["calculating","native_busy"].includes(price?.status)) return "Resolving specification…";
  return "Specification not yet resolved";
}
export function glassSpecification(line,settings,price) {
  const options = resolvedWindowOptions(line,settings,price);
  return ["glass","tempered","glazing_method","glass_thickness"].filter(key => has(options[key])).map(key => specificationValue(key,options[key])).join(" · ");
}
export function currentPricePreview(result,inputKey) {
  return result?.inputKey === inputKey ? result : {status:"loading",lines:[],total:null,ready:false};
}

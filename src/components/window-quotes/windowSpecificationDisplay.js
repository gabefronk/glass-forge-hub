import { catalogOptionDefaults } from "../../../base44/shared/amscoOptionDefaults.js";

// Display values only. Never write resolved defaults into the requested options:
// an omitted thickness must stay automatic when dimensions change.
const has = value => value !== undefined && value !== null && value !== "";
const fields = new Set(["series","fin","color","exterior_color","interior_color","glass","tempered","patterned_glass","screen","hardware","hardware_color","glass_thickness","glass_panes","glazing_method","elevation","argon","super_spacer","capillary_tubes","grilles","operation","sash_split","number_wide","unit_type"]);
const pick = source => Object.fromEntries(Object.entries(source || {}).filter(([key,value]) => fields.has(key) && has(value)));

export const GLASS_THICKNESS_CHOICES = [
  {value:"SS over SS",label:"Single-strength over single-strength (SS/SS)"},
  {value:"DS over DS",label:"Double-strength over double-strength (DS/DS)"},
  {value:'3/16" over 3/16"',label:"3/16″ over 3/16″"},
  {value:'1/4" over 1/4"',label:"1/4″ over 1/4″"}
];
export function specificationValue(key,value,options = {}) {
  if (!has(value)) return "";
  if (key === "tempered") return value === true || value === "true" ? "Tempered glass" : value === false || value === "false" ? "Non-tempered glass" : String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "glass_thickness") {
    if (value === "Differ" && Array.isArray(options.glass_panes)) return options.glass_panes.map(pane => `${pane.name}: ${specificationValue("glass_thickness",pane.glass_thickness)}`).join("; ");
    const normalized = String(value).replaceAll(" inch",'"');
    return GLASS_THICKNESS_CHOICES.find(choice => choice.value === normalized)?.label ||
      (value === "SS" ? "Single-strength (SS; pane construction unspecified)" : value === "DS" ? "Double-strength (DS; pane construction unspecified)" : normalized.replaceAll('"',"″").replace(/\bSS\b/g,"Single-strength").replace(/\bDS\b/g,"Double-strength"));
  }
  if (key === "glazing_method") return String(value).replace(/^(3\/4|1)(?: inch Insulated Glass|" Insulated| Insulated)$/, "$1″ insulated glass unit");
  return String(value);
}
export function resolvedWindowOptions(line = {},settings = {},price) {
  const inherited = pick(settings);
  if (!has(inherited.glass) && settings.low_e === true) inherited.glass = "CozE (LowE)";
  return {...pick(catalogOptionDefaults(line,settings)),...inherited,...pick(line.options),...(price?.status === "priced" ? {
    ...(price.price_source === "amsco_source_engine" ? pick(price.source_engine?.applied_defaults) : {}),
    ...pick(price.resolved_options)
  } : {})};
}
export function automaticOptionLabel(key,line = {},settings = {},price,priceStatus) {
  // Resolve defaults without waiting for a successful price. In particular,
  // changing a grille or an offline native runner must not blank the fields.
  const automaticLine = {...line,options:{...line.options}};
  delete automaticLine.options[key];
  const explicit = has(line.options?.[key]);
  // An explicit override's result cannot describe the value selected by reset.
  const resolved = explicit ? resolvedWindowOptions(automaticLine,settings,undefined) : resolvedWindowOptions(line,settings,price);
  const value = resolved[key];
  if (has(value)) {
    if (key === "tempered") return value === true || value === "true" ? "Yes" : value === false || value === "false" ? "No" : String(value);
    if (key === "argon" && (value === false || value === "false")) return "None";
    return specificationValue(key,value,resolved);
  }
  if (!line.style) return "— Select —";
  // Keep unported constructions on AMSCO's automatic selection, not a guessed
  // SS/SS value. Native responses supply the actual glass when available.
  if (key === "glass_thickness") return "By window size";
  if (key === "capillary_tubes") return "By installation elevation";
  return "Automatic";
}
export function glassSpecification(line,settings,price) {
  const options = resolvedWindowOptions(line,settings,price);
  return ["glass","tempered","glazing_method","glass_thickness"].filter(key => has(options[key])).map(key => specificationValue(key,options[key],options)).join(" · ");
}
export function currentPricePreview(result,inputKey) {
  return result?.inputKey === inputKey ? result : {status:"loading",lines:[],total:null,ready:false};
}

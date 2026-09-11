export function savedScheduleData(quote = {}) {
  const accepted = quote.sales_status === "won" ? quote.accepted_snapshot : null;
  const result = accepted?.result || quote.result;
  const verified = result?.verified === true && (quote.worker_status === "ready" || quote.sales_status === "won");
  const hasResultLines = verified && Array.isArray(result.lines) && result.lines.length > 0;
  const sourceLines = hasResultLines ? result.lines : accepted?.lines || quote.lines || [];
  const lines = sourceLines.map(line => ({...line, qty:line.qty ?? line.quantity, options:line.options || {}}));
  const prices = hasResultLines ? sourceLines.map(line => ({
    status:"priced",
    price_source:line.pricing_evidence?.source,
    pricing_evidence:line.pricing_evidence,
    resolved_options:line.options,
    unit_prices:{
      list:line.list_unit ?? line.unit_prices?.list,
      dealer:line.dealer_unit ?? line.unit_prices?.dealer,
      customer:line.customer_unit ?? line.unit_prices?.customer ?? line.customer_price ?? line.unit_price
    },
    line_totals:{
      list:line.list_extended ?? line.line_totals?.list,
      dealer:line.dealer_extended ?? line.line_totals?.dealer,
      customer:line.customer_extended ?? line.line_totals?.customer ?? line.extended_price ?? line.total
    }
  })) : [];
  return {lines,prices,settings:accepted?.settings || quote.settings || {},currency:result?.totals?.currency || result?.currency || "USD"};
}

export function additionalLineSpecifications(line = {}) {
  const excluded = new Set(["series", "color", "exterior_color", "interior_color", "fin", "glass", "tempered", "patterned_glass", "screen", "hardware", "hardware_color", "glass_thickness", "glass_panes", "glazing_method", "elevation", "argon", "super_spacer", "capillary_tubes", "grilles", "operation", "sash_split", "number_wide", "unit_type"]);
  const safe = (value, key) => value !== undefined && value !== null && value !== "" && ["string","number","boolean"].includes(typeof value) && !/(?:^|_)(?:id|url|uri|password|token|secret|login|auth|cookie|session)(?:_|$)/i.test(key) && !/https?:\/\//i.test(String(value));
  const native = line.native_configuration || line.configuration || {};
  const fields = {...Object.fromEntries(Object.entries(line.options || {}).filter(([key]) => !excluded.has(key))), ...native};
  return Object.entries(fields).filter(([key,value]) => safe(value,key)).map(([key,value]) => [key.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," "), value === true ? "Yes" : value === false ? "No" : String(value)]);
}

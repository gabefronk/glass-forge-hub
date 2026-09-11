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

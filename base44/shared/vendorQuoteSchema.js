// The vendor-quote extraction contract for the document model (jobBudgetIngest): JSON schema,
// prompt, and the mapping back onto the older material_true_cost / actual_total_sell fields.

export const QUOTE_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: ['string', 'null'], description: 'Company that issued the quote (letterhead), e.g. WTS Paradigm, AMSCO, Builders FirstSource' },
    manufacturer: { type: ['string', 'null'] },
    quote_number: { type: ['string', 'null'] },
    quote_name: { type: ['string', 'null'], description: '"Quote Name" field if printed' },
    project_name: { type: ['string', 'null'], description: '"Project Name" field if printed' },
    customer_po: { type: ['string', 'null'], description: 'Customer PO # / CPO if printed, e.g. YA-0007' },
    quoted_by: { type: ['string', 'null'], description: 'Quoted by / entered by / sales rep' },
    bill_to: { type: ['string', 'null'] },
    ship_to: { type: ['string', 'null'] },
    builder: { type: ['string', 'null'], description: 'Builder/customer the job belongs to' },
    lot_or_address: { type: ['string', 'null'], description: 'Jobsite lot number or street address if printed (not the vendor or bill-to address)' },
    openings_qty: { type: ['integer', 'null'], description: 'Total window/door/glass units across all lines' },
    price_levels: { type: ['string', 'null'], enum: ['dealer_and_customer', 'single', null], description: 'dealer_and_customer when the quote prints BOTH a dealer/cost price and a separate customer/retail price; single when it prints one price level (list vs net counts as single: net is the price)' },
    dealer_subtotal: { type: ['number', 'null'], description: 'Only when price_levels is dealer_and_customer: the dealer cost subtotal before tax (e.g. "Dealer Sub")' },
    net_total: { type: ['number', 'null'], description: 'Single price level: the total the bill-to account pays before tax (sum of NET/extended prices, Sub Total, Balance Due before tax). Never the LIST price.' },
    customer_sub_total: { type: ['number', 'null'], description: 'Customer price subtotal before tax, if printed' },
    customer_tax: { type: ['number', 'null'], description: 'Sales tax charged on this quote: the SUM of every tax line printed (state, county, city, "Sales Tax", "Tax"). Use 0 only when a tax line is printed showing 0.00. Use null when no tax line is printed anywhere.' },
    tax_lines: {
      type: 'array',
      description: 'Every tax line printed anywhere on the quote (totals box, summary, or a line item), exactly as printed. Empty when there is none.',
      items: {
        type: 'object',
        properties: {
          label: { type: ['string', 'null'], description: 'As printed, e.g. "Sales Tax", "UT State Tax", "Tax 7.45%"' },
          rate_pct: { type: ['number', 'null'], description: 'Tax rate in percent if printed, e.g. 7.45' },
          amount: { type: ['number', 'null'], description: 'Tax amount in dollars as printed' },
        },
      },
    },
    customer_total: { type: ['number', 'null'], description: 'Grand TOTAL including tax as printed' },
    lines: {
      type: 'array',
      description: 'One entry per quote line item',
      items: {
        type: 'object',
        properties: {
          qty: { type: ['integer', 'null'] },
          width_in: { type: ['number', 'null'], description: 'Unit/overall width in inches (first number of e.g. 33.625 x 55.5)' },
          height_in: { type: ['number', 'null'], description: 'Unit/overall height in inches' },
          kind: { type: ['string', 'null'], enum: ['window', 'door', 'glass', 'part', null], description: 'glass = glass/IGU only (no frame); part = screens, mull kits, hardware, freight, fees' },
          description: { type: ['string', 'null'], description: 'Product line text, e.g. "Glass Only", "Single Hung", "2 Panel Slider 6/8"' },
          mark: { type: ['string', 'null'], description: 'Line #, mark or room location' },
          extended: { type: ['number', 'null'], description: 'Extended (qty x net) price for the line' },
        },
      },
    },
  },
};

export const QUOTE_PROMPT = `You are reading a window/door/glass vendor quote PDF for a glazing contractor
(Glass Forge; Gabriel Fronk). Extract the header, every line item and the totals exactly as printed.
Price levels: AMSCO "Dealer Total Pricing" quotes print a dealer cost AND a customer price -> price_levels
"dealer_and_customer", dealer_subtotal = the dealer sub total. Most other quotes (WTS Paradigm, AMSCO
Studio, BFS order acknowledgements) print ONE price level -> "single": put the pre-tax total in net_total
and customer_sub_total, the grand total in customer_total. A LIST PRICE column is not a price level; NET
is the price. Count every window, door and glass unit for openings_qty. Use null for anything not
printed; never guess.
TAX: look for a sales tax line anywhere - the totals box, a summary, or a separate line item ("Sales Tax",
"Tax", "State/County/City Tax", a percentage like 7.45%). List each one in tax_lines with its amount and
rate, and put their sum in customer_tax. A tax line is never a window/door/glass line item. If no tax line
is printed, leave tax_lines empty and customer_tax null - do not write 0 unless 0.00 is printed.`;

// The quote fields the old schema used, filled from the richer extraction.
export function legacyTotals(q) {
  if (q.price_levels === 'dealer_and_customer') {
    if (q.material_true_cost == null) q.material_true_cost = q.dealer_subtotal;
    if (q.actual_total_sell == null) q.actual_total_sell = q.customer_total;
  } else if (q.price_levels === 'single') {
    q.material_true_cost = null;
    if (q.actual_total_sell == null) q.actual_total_sell = q.customer_total;
  }
  return q;
}

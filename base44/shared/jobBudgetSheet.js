// Budget sheet output: a CSV summary (easy to preview anywhere) and a filled copy
// of Gabriel's "Window Budget Sheet" workbook (his real template, yellow cells in,
// formula results cached so any viewer shows the numbers without recalculating).
// Pure functions; callers handle bytes/upload.

import { computeJobBudget, isoToExcelSerial, roundMoney } from './jobBudgetMath.js';

export function buildBudgetCsv({ quote, budget, fields = {} }) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const row = (label, value) => `${esc(label)},${esc(value)}`;
  const lines = [
    row('Window Budget Sheet', ''),
    row('Sales Rep', fields.sales_rep || ''),
    row('Date', fields.date || ''),
    row('Builder Name', fields.builder || ''),
    row('Lot #', fields.lot || ''),
    row('Address', fields.address || ''),
    row('City, State, Zip', fields.city_state_zip || ''),
    row('Contact Name/Number', fields.contact || ''),
    row('Delivery Date', fields.delivery_date || ''),
    row('Requested Install Date', fields.install_date || ''),
    row('Manufacturer', quote?.manufacturer || ''),
    row('Vendor Quote #', quote?.quote_number || ''),
    row('Quote Name', quote?.quote_name || ''),
    row('Quoted By', quote?.quoted_by || ''),
    row('Quantity Of Openings', quote?.openings_qty ?? ''),
    row('Material True Cost from Quote', budget.material_true_cost),
    row('Overhead Adder', budget.overhead_adder),
    row('Budget Cost Total (Material)', budget.budget_cost_total_material),
    row('Use Tax', budget.use_tax),
    row('Cost Material/Tax', budget.cost_material_tax),
    row('Sell Material/Tax @ 30% margin', budget.sell_material_tax_target),
    row('Labor Cost (Sub Pay, non taxable)', budget.labor_cost_sub_pay),
    row('Labor Sell Price (non taxable)', budget.labor_sell_price),
    row('Labor Sell @ 27% margin', budget.labor_target_sell),
    row('Total Cost of Material and Labor (Overhead)', budget.total_cost_overhead),
    row('Total Sell to Customer (includes tax)', budget.actual_total_sell),
    row('Margin %', budget.actual_margin_pct === null ? '' : (budget.actual_margin_pct * 100).toFixed(2) + '%'),
    row('Suggested Total Sell', budget.suggested_total_sell),
  ];
  return lines.join('\n') + '\n';
}

// ---- Workbook fill --------------------------------------------------------
// Cell map verified against the template's sheet1.xml. Strings are written as
// inline strings so sharedStrings.xml stays untouched; numbers keep the cell's
// existing style. Formula cells get their cached <v> refreshed so the numbers
// are right even before Excel/Sheets recalculates on open.

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function setCell(xml, ref, kind, value) {
  const re = new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>|<c r="${ref}"([^>]*)/>`);
  const m = xml.match(re);
  const attrs = (m && (m[1] || m[3] || '') || '')
    .replace(/\s*t="[^"]*"/, ''); // keep style, drop old type
  const f = m && m[2] && m[2].match(/<f>[\s\S]*?<\/f>/);
  const inner = kind === 'str'
    ? ` t="inlineStr"><is><t>${escXml(value)}</t></is>`
    : `>${f ? f[0] : ''}<v>${value}</v>`;
  const cell = `<c r="${ref}"${attrs}${inner}</c>`;
  return m ? xml.replace(re, cell) : xml;
}

// values: { sales_rep, date_iso, builder, lot, address, city_state_zip, contact,
//   delivery_date_iso, install_date_iso, manufacturer, openings_qty }
// budget: output of computeJobBudget()
export function fillBudgetXlsx(templateBytes, values, budget, zipTools) {
  const { unzipSync, zipSync, strFromU8, strToU8 } = zipTools;
  const files = unzipSync(templateBytes);
  const path = 'xl/worksheets/sheet1.xml';
  let xml = strFromU8(files[path]);

  const strs = {
    B2: values.sales_rep,
    B5: values.builder,
    B6: values.lot,
    B7: values.address,
    B8: values.city_state_zip,
    B9: values.contact,
    B12: values.manufacturer,
  };
  for (const [ref, v] of Object.entries(strs)) if (v !== undefined && v !== null && v !== '') xml = setCell(xml, ref, 'str', v);

  if (values.date_iso) xml = setCell(xml, 'B3', 'num', isoToExcelSerial(values.date_iso));
  if (values.delivery_date_iso) xml = setCell(xml, 'B10', 'str', values.delivery_date_iso);
  if (values.install_date_iso) xml = setCell(xml, 'B11', 'str', values.install_date_iso);
  if (values.openings_qty) xml = setCell(xml, 'C14', 'num', values.openings_qty);

  xml = setCell(xml, 'C15', 'num', budget.material_true_cost);
  xml = setCell(xml, 'C24', 'num', budget.labor_sell_price);
  xml = setCell(xml, 'C28', 'num', budget.actual_total_sell);
  // Cached formula results.
  xml = setCell(xml, 'C16', 'num', budget.overhead_adder);
  xml = setCell(xml, 'C17', 'num', budget.budget_cost_total_material);
  xml = setCell(xml, 'C20', 'num', budget.use_tax);
  xml = setCell(xml, 'C21', 'num', budget.cost_material_tax);
  if (budget.sell_material_tax_target !== null) xml = setCell(xml, 'C22', 'num', budget.sell_material_tax_target);
  xml = setCell(xml, 'C27', 'num', budget.total_cost_overhead);
  if (budget.actual_margin_pct !== null) xml = setCell(xml, 'C29', 'num', budget.actual_margin_pct);

  files[path] = strToU8(xml);
  return zipSync(files);
}

export { computeJobBudget, roundMoney };

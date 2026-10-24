// Use tax is owed only when the supplier didn't charge sales tax (Gabe, Oct 24 2026).
// A PO or supplier-order amount already carries the supplier's tax when the owner ticked
// "amount already includes sales tax" on the record (includes_sales_tax), or when it
// equals the taxed total printed on its budget's supplier quote (quote.customer_total,
// with a customer_tax above zero). Any other amount is treated as untaxed.
import { SALES_TAX_RATE } from './purchasingCoreTwin.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function supplierTaxIncluded(amount, budget, record = null) {
  const a = num(amount);
  if (a != null && record?.includes_sales_tax === true) return true;
  const total = num(budget?.quote?.customer_total);
  const tax = num(budget?.quote?.customer_tax);
  return a != null && total != null && tax != null && tax > 0 && Math.abs(a - total) <= 0.01;
}

// Job cost of a supplier amount: as-is when the supplier charged tax, else plus use tax.
export function costWithUseTax(amount, budget, record = null) {
  const a = num(amount);
  if (a == null) return null;
  return supplierTaxIncluded(a, budget, record) ? round(a) : round(a * (1 + SALES_TAX_RATE));
}

import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseCsv, parseMoney, parseDate, parseBankExport, withFingerprints, suggestBankLine, planBankImport, bankMonth, bankCoverage, bankByCategory, bankDays } = await import('../src/lib/bankLines.js');
const { companyYear } = await import('../src/lib/companyOverview.js');

// The QuickBooks bank-feed export's shape (made-up amounts except where a test says otherwise).
const QBO = `﻿Date,Bank description,Spent,Received,From/To,Match/Categorize
"10/22/2026","Draft Withdrawal","$132,074.19","","","Other business expenses:Bank and credit card fees"
"10/22/2026","Draft Withdrawal","$1,320.00","","","Other business expenses:Bank and credit card fees"
"10/19/2026","Draft Withdrawal","$1,950.00","","","Other business expenses:Bank and credit card fees"
"10/19/2026","Draft Withdrawal","$1,950.00","","","Other business expenses:Bank and credit card fees"
"10/17/2026","Deposit","","$61,319.03","","Sales"
"10/16/2026","Builders Firstsource","$3,289.52","","",""
"10/15/2026","Company","$1,890.37","","","Insurance"
"10/14/2026","Deposit Intuit Entry","","$12,170.78","","Sales"
"10/14/2026","Company","$3,000.00","","","Payroll expenses:Wages"
"10/14/2026","Intuit","$121.71","","","Other business expenses:Bank and credit card fees"
"10/08/2026","Banking","$4,843.29","","","Other business expenses:Bank and credit card fees"
"10/08/2026","Company","$7,787.92","","",""
"10/05/2026","ABC Supply","$1,506.49","","ABC Supply","Cost of goods sold:Direct supplies & materials"
`;
const ctx = {
  vendorOrders: [{ id: 'vo-taira', amount: 132074.19, job_id: 'taira', job_name: 'Taira Res', vendor: 'AMSCO', order_number: '10-858.26', purchase_order_id: 'po-9', created_date: '2026-10-22T15:16:49' }],
  purchaseOrders: [
    { id: 'po-9', po_number: 'YA-0009', job_id: 'taira', amount_dealer: null, status: 'ordered', created_date: '2026-10-14T09:37:04' },
    { id: 'po-10', po_number: 'YA-0010', job_id: 'perry', job_name: 'Perry Res', vendor: 'AMSCO', amount_dealer: 7787.92, status: 'ordered', created_date: '2026-10-14T09:37:04' },
  ],
  sales: [{ id: 'forte', name: 'Forte Res', sale: 24341.56 }],
};

test('CSV, money and dates parse the way banks and QuickBooks write them', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.equal(parseMoney('$1,506.49'), 1506.49);
  assert.equal(parseMoney('(1,506.49)'), -1506.49);
  assert.equal(parseMoney('-12.5'), -12.5);
  assert.equal(parseMoney(''), null);
  assert.equal(parseDate('10/5/2026'), '2026-10-05');
  assert.equal(parseDate('2026-10-23'), '2026-10-23');
  assert.equal(parseDate('nope'), '');
});

test('the QuickBooks bank-feed export reads as signed lines: spent negative, received positive', () => {
  const lines = parseBankExport(QBO);
  assert.equal(lines.length, 13);
  assert.deepEqual(lines[0], { posted_date: '2026-10-22', description: 'Draft Withdrawal', amount: -132074.19, from_to: '', qb_category: 'Other business expenses:Bank and credit card fees' });
  assert.equal(lines[4].amount, 61319.03);
  assert.equal(lines[12].from_to, 'ABC Supply');
});

test('a plain bank CSV with one signed Amount column reads too', () => {
  const lines = parseBankExport('Posted Date,Description,Amount\n10/01/2026,ACH DEPOSIT,500.00\n10/02/2026,CHECK 1001,-75.25\n');
  assert.deepEqual(lines.map((l) => [l.posted_date, l.description, l.amount]), [['2026-10-01', 'ACH DEPOSIT', 500], ['2026-10-02', 'CHECK 1001', -75.25]]);
  assert.throws(() => parseBankExport('Foo,Bar\n1,2\n'), /no Date and amount/);
});

test('identical lines on the same day get their own fingerprints', () => {
  const f = withFingerprints(parseBankExport(QBO), 'Acct').map((l) => l.fingerprint);
  assert.ok(f.includes('Acct|2026-10-19|-195000|draft withdrawal|1'));
  assert.ok(f.includes('Acct|2026-10-19|-195000|draft withdrawal|2'));
  assert.equal(new Set(f).size, f.length);
});

test('each line gets a category: exact Hub matches first, then the description rules', () => {
  const by = Object.fromEntries(planBankImport(QBO, ctx).lines.map((l) => [`${l.posted_date} ${l.description} ${l.amount}`, l]));
  const taira = by['2026-10-22 Draft Withdrawal -132074.19'];
  assert.deepEqual([taira.category, taira.match, taira.job_id, taira.vendor_order_id, taira.purchase_order_id], ['job_cost', 'exact', 'taira', 'vo-taira', 'po-9']);
  const perry = by['2026-10-08 Company -7787.92'];
  assert.deepEqual([perry.category, perry.job_id, perry.purchase_order_id], ['job_cost', 'perry', 'po-10']);
  const forte = by['2026-10-14 Deposit Intuit Entry 12170.78'];
  assert.deepEqual([forte.category, forte.match, forte.job_id], ['customer_payment', 'exact', 'forte']);
  assert.equal(by['2026-10-17 Deposit 61319.03'].category, 'labor_payment');
  assert.equal(by['2026-10-22 Draft Withdrawal -1320'].category, 'crew_pay');
  assert.equal(by['2026-10-14 Company -3000'].category, 'payroll');
  assert.equal(by['2026-10-15 Company -1890.37'].category, 'overhead');
  assert.equal(by['2026-10-14 Intuit -121.71'].category, 'overhead');
  assert.equal(by['2026-10-16 Builders Firstsource -3289.52'].category, 'supplier');
  assert.equal(by['2026-10-05 ABC Supply -1506.49'].category, 'supplier');
  // QuickBooks calls it a bank fee; nothing says what it is, so it is not sorted (still a cost).
  assert.equal(by['2026-10-08 Banking -4843.29'].category, 'other_cost');
});

test('a big draft with no Hub order is not crew pay, and an order matches one bank line only', () => {
  assert.equal(suggestBankLine({ posted_date: '2026-10-22', description: 'Draft Withdrawal', amount: -9000 }, ctx).category, 'other_cost');
  const two = `Date,Bank description,Spent,Received\n10/08/2026,Company,"$7,787.92",\n10/09/2026,Company,"$7,787.92",\n`;
  assert.deepEqual(planBankImport(two, ctx).lines.map((l) => l.category), ['job_cost', 'other_cost']);
  // An order raised long before the payment is not a match.
  assert.equal(suggestBankLine({ posted_date: '2027-06-01', description: 'Company', amount: -7787.92 }, ctx).category, 'other_cost');
});

test('older exports: checks are crew pay, Glass Forge invoices, loans, Amex, taxes and ACH customers sort', () => {
  const invoices = [
    { id: 'gf1', kind: 'glass_forge', invoice_number: 'GF-2026-001', service_month: '2026-03', invoice_date: '2026-03-31', amount: 8321.3 },
    { id: 'gf9', kind: 'labor_billing', invoice_number: 'Q-1', invoice_date: '2026-03-31', amount: 1600 },
  ];
  const s = (description, amount, extra = {}) => suggestBankLine({ posted_date: '2026-04-14', description, amount, ...extra }, { invoices });
  assert.deepEqual([s('Check 903', -8321.3).category, s('Check 903', -8321.3).match_note], ['glass_forge', 'GF-2026-001 (2026-03)']);
  // Paid before the invoice existed: not that invoice.
  assert.equal(suggestBankLine({ posted_date: '2026-03-01', description: 'Check 1', amount: -8321.3 }, { invoices }).category, 'other_cost');
  assert.equal(s('Glass Forge Llc', -25935.82, { from_to: 'Glass Forge LLC' }).category, 'glass_forge');
  assert.equal(s('Check 905', -1670).category, 'crew_pay');
  assert.equal(s('Check 1600', -1600).category, 'crew_pay');
  assert.equal(s('Check 920', -5000).category, 'other_cost');
  assert.equal(s('Loan', -4010.06, { qb_category: 'Interest Expense' }).category, 'loan');
  assert.equal(s('Withdrawal Transfer L', -499.39).category, 'loan');
  assert.equal(s('American Express', -10244.65, { qb_category: 'Other business expenses:Bank and credit card fees' }).category, 'card');
  assert.equal(s('Internal Revenue Service', -22538, { qb_category: 'Taxes and Licenses:Payroll taxes' }).category, 'payroll');
  assert.equal(s('Comment Type Payroll', -2500, { qb_category: 'Payroll expenses:Wages' }).category, 'payroll');
  assert.equal(s('QuickBooks', -116.59).category, 'overhead');
  assert.equal(s('Windows Doors Ach', -43126.27, { from_to: 'ABC Supply' }).category, 'supplier');
  assert.equal(s('Company', -17849.94, { qb_category: 'Cost of goods sold:Direct supplies & materials' }).category, 'supplier');
  assert.equal(s('Deposit By', 62963).category, 'labor_payment');
  assert.equal(s('Deposit by Check', 35340).category, 'labor_payment');
  assert.equal(s('Deposit Ach Mh', 5842.71).category, 'customer_payment');
  assert.equal(s('Deposit Mhsoniq Window', 11387.5, { from_to: 'Aspen Ridge Remodeling' }).match_note, 'ACH customer payment from Aspen Ridge Remodeling');
  assert.equal(s('Intuit Deposit', 0.22, { qb_category: 'Other income:Credit card rewards' }).category, 'other_income');
  assert.equal(s('Intuit Deposit Ach', 2400).category, 'customer_payment');
  // One invoice pays once.
  const two = planBankImport('Date,Bank description,Spent,Received\n04/14/2026,Check 903,"$8,321.30",\n04/15/2026,Check 904,"$8,321.30",\n', { invoices });
  assert.deepEqual(two.lines.map((l) => [l.category, l.invoice_id || '']), [['glass_forge', 'gf1'], ['other_cost', '']]);
});

test('each import covers its first to last day, so a month knows how much of it is in', () => {
  const lines = [
    { posted_date: '2026-08-30', amount: -1, category: 'crew_pay', import_batch: 'a' },
    { posted_date: '2026-09-01', amount: -1, category: 'crew_pay', import_batch: 'a' },
    { posted_date: '2026-10-05', amount: -1, category: 'crew_pay', import_batch: 'b' },
    { posted_date: '2026-10-07', amount: -1, category: 'crew_pay', import_batch: 'b' },
  ];
  const days = bankDays(lines);
  assert.equal(days.size, 3 + 3);
  assert.deepEqual([bankMonth(lines, '2026-08', days).coveredDays, bankMonth(lines, '2026-09', days).coveredDays, bankMonth(lines, '2026-10', days).coveredDays], [2, 1, 3]);
  const y = companyYear({ rows: [], bankLines: lines, today: '2026-10-26', start: '2026-01' });
  assert.deepEqual(y.months.slice(7).map((m) => [m.month, m.bank.coveredDays, m.monthDays]), [['2026-08', 2, 31], ['2026-09', 1, 30], ['2026-10', 3, 26]]);
});

test('re-importing an overlapping export adds only the new lines', () => {
  const first = planBankImport(QBO, ctx);
  const again = planBankImport(QBO, { ...ctx, existing: first.lines });
  assert.deepEqual([again.lines.length, again.skipped, again.total], [0, 13, 13]);
  const more = planBankImport(`${QBO}"10/23/2026","Intuit","$13.14","","",""\n`, { ...ctx, existing: first.lines });
  assert.deepEqual(more.lines.map((l) => l.amount), [-13.14]);
});

test('a bank month counts crew pay, overhead and other costs, and leaves out what the Hub already counts', () => {
  const lines = planBankImport(QBO, ctx).lines;
  const m = bankMonth(lines, '2026-10');
  assert.deepEqual(
    { crewPay: m.crewPay, overhead: m.overhead, otherCost: m.otherCost, otherIncome: m.otherIncome, hasBank: m.hasBank, lines: m.lines },
    // crew 1,320 + 1,950 × 2; overhead 1,890.37 + 3,000 + 121.71; other 3,289.52 + 4,843.29 + 1,506.49
    { crewPay: 5220, overhead: 5012.08, otherCost: 9639.3, otherIncome: 0, hasBank: true, lines: 13 },
  );
  assert.equal(m.moneyIn, 73489.81);
  assert.equal(m.moneyOut, -159733.49);
  assert.equal(bankMonth(lines, '2026-09').hasBank, false);
  assert.deepEqual(bankCoverage(lines), { first: '2026-10-05', last: '2026-10-22', months: ['2026-10'], count: 13 });
  const cats = bankByCategory(lines);
  assert.equal(cats.rows.find((r) => r.key === 'job_cost').total, -139862.11);
  assert.equal(cats.rows.reduce((n, r) => n + r.total, 0).toFixed(2), (73489.81 - 159733.49).toFixed(2));
});

test('the overview takes bank costs off profit for months with bank lines only', () => {
  const install = (id, month, labor) => ({ id, invoice_month: month, job_date: `${month}-10`, billable: true, fee_type: 'labor_pct', labor_amt: labor, calendar_labor_amt: labor, fee_pct: 0.1 });
  const bankLines = [
    { posted_date: '2026-02-03', amount: -400, category: 'crew_pay' },
    { posted_date: '2026-02-04', amount: -100, category: 'overhead' },
    { posted_date: '2026-02-05', amount: -50, category: 'other_cost' },
    { posted_date: '2026-02-06', amount: 25, category: 'other_income' },
    { posted_date: '2026-02-07', amount: -9999, category: 'job_cost' },
    { posted_date: '2026-02-08', amount: 1000, category: 'labor_payment' },
  ];
  const y = companyYear({ rows: [install('a', '2026-01', 1000), install('b', '2026-02', 1000)], bankLines, today: '2026-02-20', start: '2026-01' });
  const [jan, feb] = y.months;
  assert.deepEqual([jan.hasBank, jan.crewPay, jan.profit], [false, 0, 900]);
  assert.deepEqual([feb.hasBank, feb.crewPay, feb.overhead, feb.otherCost, feb.otherIncome, feb.income, feb.profit], [true, 400, 100, 50, 25, 1025, 375]);
  assert.deepEqual([y.ytd.crewPay, y.ytd.profit, y.ytd.bankMonths], [400, 1275, ['2026-02']]);
});

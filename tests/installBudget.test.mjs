import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticBaseRate, calculateInstall, newInstallBudget, quoteInstallSummary, validateInstallBudget, INSTALL_CATALOG } from '../base44/shared/installBudget.js';
const line = patch => ({ id: 'w1', style: 'Studio Picture', qty: 1, width: 60, height: 60, units: 'in', ...patch });
test('all catalogue IDs are unique and have real paired sale/sub-pay rates', () => {
  assert.equal(INSTALL_CATALOG.rates.length, 91);
  assert.equal(new Set(INSTALL_CATALOG.rates.map(r => r.id)).size, 91);
  for (const rate of INSTALL_CATALOG.rates) { assert.ok(Number.isFinite(rate.sell) && Number.isFinite(rate.cost)); assert.ok(rate.source.sell.includes('Sell!')); assert.ok(rate.source.cost.includes('SubPay!')); }
});
test('source window size bands including unrounded boundaries', () => {
  for (const [sqft, vinyl, composite, wood] of [[19.99,52,66,114],[20,52,66,214],[29.999,52,66,214],[30,66,87,214],[39.99,66,87,214],[40,66,87,429],[47.999,66,87,429],[48,132,246,429],[59.999,132,246,429],[60,132,246,643],[60.001,300,415,643],[80,300,415,929],[89.999,300,415,929]]) {
    assert.equal(automaticBaseRate('vinyl',sqft).sell,vinyl);assert.equal(automaticBaseRate('composite',sqft).sell,composite);assert.equal(automaticBaseRate('wood',sqft).sell,wood);
  }
  assert.equal(automaticBaseRate('wood',0.9),null);
  assert.equal(automaticBaseRate('wood',90),null); assert.equal(automaticBaseRate('vinyl',0),null);
});
test('three 5x5 vinyl windows use listed sale and sub-pay without charging flashing twice', () => {
  const result=calculateInstall([line({qty:3})],newInstallBudget(true));
  assert.equal(result.sell,156);assert.equal(result.cost,108);assert.equal(result.lines[0].sqft,25);
});
test('install method and dark AMSCO exterior are counted once per unit', () => {
  const config=newInstallBudget(true);config.method='vf-window-adder-30';config.selections.w1={adders:['vf-window-adder-26']};
  const result=calculateInstall([line({qty:2,options:{color:'Black exterior / White interior'}})],config);
  assert.equal(result.sell,178);assert.equal(result.cost,124);assert.equal(result.lines[0].charges.length,3);
  assert.equal(calculateInstall([line({options:{color:'White exterior / Black interior'}})],newInstallBudget(true)).sell,52);
});
test('deselection and disabling prevent installation from accumulating', () => {
  const config=newInstallBudget(true);config.selections.w1={enabled:false};
  assert.equal(calculateInstall([line({})],config).sell,0);
  const disabled=calculateInstall([line({})],newInstallBudget()); assert.equal(disabled.sell,0);assert.equal(disabled.enabled,false);
});
test('wood ladder uses $14 and bifold 5–6 KD pairs source rows by meaning', () => {
  const config=newInstallBudget(true);config.material='wood';config.selections.w1={adders:['wood-left-39']};config.extras=[{rate_id:'wood-right-40',qty:1}];
  const result=calculateInstall([line({width:36,height:60})],config);
  assert.equal(result.sell,1557);assert.equal(result.cost,1090);
  assert.equal(result.extras[0].source.cost,'Wood SubPay!H38');
});
test('door panels use explicitly selected per-panel rate and correct quantity', () => {
  const config=newInstallBudget(true);config.material='wood';config.selections.w1={rate_id:'wood-right-11'};
  const result=calculateInstall([line({style:'Multislide Door',qty:4,width:'',height:''})],config);
  assert.equal(result.sell,972);assert.equal(result.cost,680);assert.equal(result.lines[0].unit,'panel');
});
test('missing dimensions, unknown products and absent rates never return valid zero totals', () => {
  const config=newInstallBudget(true);
  for(const rows of [[line({width:''})],[line({qty:0})],[line({style:'Multislide Door'})],[]]) { const result=calculateInstall(rows,config);assert.equal(result.complete,false);assert.equal(result.sell,null); }
  assert.equal(calculateInstall([line({style:'Custom product'})],config,{linked:true}).complete,false);
  config.material='wood';assert.equal(calculateInstall([line({width:120,height:108})],config).complete,false);
});
test('standalone budget reproduces C16/C17/C20/C21/C27 without losing zero override', () => {
  const config=newInstallBudget(true);config.finance.product_cost=1000;config.finance.extra_material=100;config.finance.equipment=50;
  const result=calculateInstall([line({qty:3})],config);
  assert.equal(result.budget.use_tax,85.68);assert.equal(result.budget.material_overhead,7.59);assert.equal(result.budget.second_overhead,7.59);assert.equal(result.budget.total_cost,1358.85);assert.equal(result.budget.material_target_sell,1776.09);assert.equal(result.budget.target_sale,1932.09);
  config.finance.product_cost=0;assert.equal(calculateInstall([line({})],config,{product_cost:9000}).budget.product_cost,0);
});
test('linked sale adds install and additional materials once without repricing saved products', () => {
  const config=newInstallBudget(true);const q={lines:[line({qty:2})],install_budget:config,worker_status:'ready',result:{verified:true,totals:{total:1500,dealer_total:1000}}};
  const result=quoteInstallSummary(q);assert.equal(result.customer_total,1604);assert.equal(result.product_sell,1500);
  const again=quoteInstallSummary(q);assert.equal(again.customer_total,1604);
  q.lines[0].qty=3;assert.equal(quoteInstallSummary(q).customer_total,1656);
  q.worker_status='draft';assert.equal(quoteInstallSummary(q).customer_total,null);
});
test('accepted install snapshots remain fixed', () => {
  const snapshot={enabled:true,sell:104,customer_total:1604};
  assert.deepEqual(quoteInstallSummary({sales_status:'won',lines:[line({qty:90})],accepted_snapshot:{install_summary:snapshot}}),snapshot);
});
test('margin pricing is optional and blank vs zero remains explicit', () => {
  const config=newInstallBudget(true);config.finance.labor_mode='margin';
  assert.equal(calculateInstall([line({})],config).sell,49.32);
  assert.equal(calculateInstall([line({})],config).budget,undefined);
  assert.throws(()=>validateInstallBudget({...config,finance:{material_margin:100}}));
  assert.throws(()=>validateInstallBudget({...config,extras:[{rate_id:'bad',qty:1}]}));
});

test('linked door panel count is explicitly confirmed separately from product systems', () => {
 const config=newInstallBudget(true); config.material='wood'; config.selections.w1={rate_id:'wood-right-11'};
 const rows=[line({style:'Multislide Door',qty:1})]; assert.equal(calculateInstall(rows,config,{linked:true}).complete,false);
 config.selections.w1.billing_qty=4; const result=calculateInstall(rows,config,{linked:true}); assert.equal(result.sell,972);assert.equal(result.cost,680);assert.equal(rows[0].qty,1);
});

test('a stale door panel count cannot change a window quantity', () => { const config=newInstallBudget(true); config.selections.w1={billing_qty:4}; const result=calculateInstall([line({qty:1})],config); assert.equal(result.sell,52); assert.equal(result.quantity,1); });

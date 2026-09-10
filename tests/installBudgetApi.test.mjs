import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteHandler } from '../base44/shared/windowQuotesCore.js';
import { newInstallBudget } from '../base44/shared/installBudget.js';
const copy = value => structuredClone(value);
function harness(role = 'admin') {
  const data = { QuoteRequests: [], InstallBudgets: [], Jobs: [] }; let next=0;
  const entities = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, {
    filter: async query => copy(rows.filter(row => Object.entries(query).every(([key,value]) => row[key] === value))),
    create: async values => { const row = { ...copy(values), id: name + '-' + (++next) };rows.push(row);return copy(row); },
    updateMany: async (query, update) => { const matched=rows.filter(row => Object.entries(query).every(([key,value]) => row[key] === value)); matched.forEach(row => Object.assign(row,copy(update.$set)));return {updated:matched.length}; },
  }]));
  const handle=createQuoteHandler({getClient:async()=>({auth:{me:async()=>({id:'admin1',email:'admin@example.test',role})},asServiceRole:{entities}})});
  const call=async body=>{const response=await handle(new Request('https://unit.test',{method:'POST',body:JSON.stringify(body)}));return {status:response.status,...await response.json()};};
  return {data,call};
}
const lines=[{id:'w1',style:'Studio Picture',qty:3,width:60,height:60,units:'in'}];
test('standalone budget saves, reopens, updates with version protection and retries once',async()=>{
  const {data,call}=harness();const body={action:'install_save',request_id:'save-1',title:'Sample budget',lines,install_budget:newInstallBudget(true)};
  const saved=await call(body);assert.equal(saved.status,200);assert.equal(saved.budget.summary.sell,156);assert.equal(saved.budget.summary.cost,108);
  const retry=await call(body);assert.equal(retry.budget.id,saved.budget.id);assert.equal(data.InstallBudgets.length,1);
  assert.equal((await call({action:'install_detail',budget_id:saved.budget.id})).budget.summary.sell,156);
  const edited=await call({...body,budget_id:saved.budget.id,expected_version:0,lines:[{...lines[0],qty:4}]});assert.equal(edited.status,200);assert.equal(edited.budget.summary.sell,208);
  assert.equal((await call({...body,budget_id:saved.budget.id,expected_version:0})).status,409);
  assert.equal((await call({action:'install_list'})).budgets.length,1);
});
test('quote install saves independently, prevents stale overwrite and does not modify product result',async()=>{
  const {data,call}=harness();data.QuoteRequests.push({id:'quote1',lines:copy(lines),input_revision:7,state_version:0,worker_status:'ready',sales_status:'open',result:{verified:true,totals:{total:1200,dealer_total:800}}});
  const before=copy(data.QuoteRequests[0].result);
  const saved=await call({action:'update_install',quote_id:'quote1',expected_install_revision:0,install_budget:newInstallBudget(true)});
  assert.equal(saved.status,200);assert.equal(saved.quote.install_summary.customer_total,1356);assert.equal(saved.quote.input_revision,7);assert.deepEqual(data.QuoteRequests[0].result,before);
  assert.equal((await call({action:'update_install',quote_id:'quote1',expected_install_revision:0,install_budget:newInstallBudget()})).status,409);
  const removed=await call({action:'update_install',quote_id:'quote1',expected_install_revision:1,install_budget:newInstallBudget()});assert.equal(removed.status,200);assert.equal(removed.quote.install_summary.enabled,false);
  data.QuoteRequests[0].sales_status='won';assert.equal((await call({action:'update_install',quote_id:'quote1',expected_install_revision:2,install_budget:newInstallBudget(true)})).status,409);
});
test('incomplete install and unauthorized users cannot write budgets',async()=>{
  const {data,call}=harness();const body={action:'install_save',request_id:'bad',title:'Invalid',lines:[{...lines[0],width:''}],install_budget:newInstallBudget(true)};
  assert.equal((await call(body)).status,400);assert.equal(data.InstallBudgets.length,0);
  assert.equal((await harness('user').call({...body,lines})).status,403);
});


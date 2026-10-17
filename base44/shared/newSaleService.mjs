import { validateNewSale,saleFigures,etaBody,ensureEta } from './newSaleCore.mjs';
import { isPurchasingMoneyOwner } from './purchasingMoneyPure.js';
import { withProcurementLock,requestKey,procurementError as fail } from './procurementLock.mjs';
import { fetchCompleteEntity } from './jobCatalog.js';
import { issuePurchaseOrder } from './purchaseOrderService.mjs';
import { budgetVersion } from './procurementCore.js';
import { findJobMatches,eligibleJobs } from './jobMatchGuard.js';
const sameFields=(actual,expected)=>expected&&typeof expected==='object'?Object.entries(expected).every(([k,v])=>sameFields(actual?.[k],v)):actual===expected;
export async function newSaleAction(api,body,user,deps){
  if(!isPurchasingMoneyOwner(user))throw fail(403,'New sales are owner-only.');
  const key=requestKey(body.request_key),sale=validateNewSale(body),fingerprint=JSON.stringify(sale),now=deps.now||(()=>new Date().toISOString());
  return withProcurementLock(api,key,async lock=>{
    const runs=await api.NewSaleRuns.filter({request_key:key},'id',2);
    if(runs.length>1)throw fail(409,'Duplicate sale runs need review.');
    let run=runs[0];
    if(run&&(run.fingerprint!==fingerprint||run.owner_id!==user.id))throw fail(409,'This sale was already started with different details. Resume the saved sale, not a second one.');
    const create=async(entity,payload)=>{try{const r=await entity.create(payload);if(!r?.id)throw Error('No id');const read=await entity.get(r.id);if(!sameFields(read,payload))throw Error('Save readback mismatch');return read;}catch{lock.holdForReview();throw fail(503,'A record save is uncertain. Stop and reconcile this request before trying a new sale.',{uncertain:true});}};
    const checkpoint=async(patch)=>{try{const saved=await api.NewSaleRuns.update(run.id,patch);if(!saved?.id)throw Error('No run');run=await api.NewSaleRuns.get(saved.id);if(!sameFields(run,patch))throw Error('Checkpoint mismatch');}catch{lock.holdForReview();throw fail(503,'Sale progress is uncertain. Reconcile before creating any other sale.',{uncertain:true});}};
    if(!run){
      const jobs=eligibleJobs(await fetchCompleteEntity(api.Jobs));
      const matches=findJobMatches({canonical_name:sale.job_name,address:sale.address,po_numbers:[]},jobs);
      if(matches.strong.length||matches.medium.length)throw fail(409,'A similar job already exists. Open Jobs and review it before creating another sale.');
      run=await create(api.NewSaleRuns,{request_key:key,fingerprint,sale,status:'saving',owner_id:user.id});
    }
    const f=saleFigures(sale);
    if(!run.job_id){const job=await create(api.Jobs,{canonical_name:sale.job_name,builder:sale.builder,address:sale.address,stage:'sold',po_numbers:[],oe_numbers:sale.order_number?[sale.order_number]:[],new_sale_run_id:run.id});await checkpoint({job_id:job.id});}
    const job=await api.Jobs.get(run.job_id);
    if(job.new_sale_run_id!==run.id||job.builder!==sale.builder||job.canonical_name!==sale.job_name||job.address!==sale.address||job.merged_into||job.is_sample)throw fail(409,'The new job changed. Review before resuming.');
    if(!run.budget_id){const budget=await create(api.JobBudgets,{job_id:job.id,job_name:job.canonical_name,builder:sale.builder,title:`${job.canonical_name} - sold scope`,vendor:sale.supplier,manufacturer:sale.supplier,quote_number:sale.quote_ref,budget_usage:'included',status:'draft',numbers_reviewed_at:now(),numbers_reviewed_by:user.email,inputs:f.inputs,computed:f.computed,notes:sale.scope,request_key:`sale:${key}`,new_sale_run_id:run.id});await checkpoint({budget_id:budget.id});}
    if(!run.money_id){const money=await create(api.JobMoneyInputs,{job_id:job.id,rough_labor_material:f.rough,sale_price:sale.sale_price,windows_incl_tax:sale.supplier_payable,new_sale_run_id:run.id});await checkpoint({money_id:money.id});}
    if(!run.note_id){const note=await create(api.JobNotes,{job_id:job.id,note_date:now().slice(0,10),interaction_type:'note',author:'Owner - new sale',body:`New sale scope: ${sale.scope}\nSite contact: ${sale.contact_name||'Not supplied'}\nPhone: ${sale.contact_phone||'Not supplied'}\nEmail: ${sale.contact_email||'Not supplied'}\nSupplier quote: ${sale.quote_ref}\nETA is an arrival reminder only; no installation booked.`,new_sale_run_id:run.id});await checkpoint({note_id:note.id});}
    if(!run.po_id){
      const budget=await api.JobBudgets.get(run.budget_id);
      const po=await issuePurchaseOrder(api,{job_id:job.id,budget_id:budget.id,budget_version:budgetVersion(budget),vendor:sale.supplier,vendor_quote_ref:sale.quote_ref,amount_dealer:sale.supplier_payable,amount_customer:sale.sale_price,notes:sale.scope,review_confirmed:true,request_key:`sale-po:${key}`},user,{...deps,withLock:async(_api,_key,work)=>work(lock)});
      await checkpoint({po_id:po.id,po_number:po.po_number});
      if(po.job_update?.ok===false)throw fail(503,'PO exists but its job reference needs review. Do not issue it again.');
    }
    const budgetCheck=await api.JobBudgets.get(run.budget_id), moneyCheck=await api.JobMoneyInputs.get(run.money_id);
    if(budgetCheck.job_id!==job.id||budgetCheck.new_sale_run_id!==run.id||!sameFields(budgetCheck.inputs,f.inputs)||moneyCheck.job_id!==job.id||moneyCheck.new_sale_run_id!==run.id||moneyCheck.rough_labor_material!==f.rough||moneyCheck.sale_price!==sale.sale_price||moneyCheck.windows_incl_tax!==sale.supplier_payable)throw fail(409,'Saved sale prices or links changed. No prices were overwritten; review before resuming.');
    const po=await api.PurchaseOrders.get(run.po_id),jobAfter=await api.Jobs.get(job.id);
    if(po.job_id!==job.id||po.budget_id!==run.budget_id||po.status==='cancelled'||po.amount_dealer!==sale.supplier_payable||po.amount_customer!==sale.sale_price||po.po_number!==run.po_number||!jobAfter.po_numbers?.includes(po.po_number))throw fail(409,'The prepared PO changed. Review before resuming.');
    const eventId='sale'+await deps.sha256(key);
    const eta=await ensureEta(deps.transport,etaBody(sale,job,po,eventId));
    await checkpoint({status:eta.state,eta_event_id:eventId,eta_url:eta.event?.htmlLink||'',last_message:eta.message||''});
    return {status:eta.state,job_id:job.id,po_id:po.id,po_number:po.po_number,budget_id:run.budget_id,eta_url:eta.event?.htmlLink||'',message:eta.message||'Job, reviewed budget, Purchasing money and prepared PO saved. ETA verified. No order, email, invoice or payment sent.'};
  },deps);
}

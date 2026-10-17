import { computeJobBudget, roundMoney } from './jobBudgetMath.js';
import { procurementError as fail } from './procurementLock.mjs';
export const FIELDS = ['job_name','builder','address','contact_name','contact_phone','contact_email','supplier','quote_ref','order_number','eta_date','eta_basis','scope','material_true_cost','labor_cost_sub_pay','labor_sell_price','additional_install_material','additional_equipment','sale_price','supplier_payable'];
const moneyFields = ['material_true_cost','labor_cost_sub_pay','labor_sell_price','additional_install_material','additional_equipment','sale_price','supplier_payable'];
export function validateNewSale(body) {
  if (!body || body.action!=='create' || body.review_confirmed!==true || !body.sale || Object.keys(body).some(k=>!['action','sale','request_key','review_confirmed'].includes(k))) throw fail(400,'Review the new sale before saving.');
  if (Object.keys(body.sale).some(k=>!FIELDS.includes(k))) throw fail(400,'Unexpected sale field.');
  const s={};
  for(const k of FIELDS) {
    if(moneyFields.includes(k)){ const v=body.sale[k];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e10)throw fail(400,`Enter a valid ${k.replaceAll('_',' ')}. Zero must be intentional.`);s[k]=roundMoney(v); }
    else { const v=body.sale[k]??'';if(typeof v!=='string'||v.length>2000||/[\u0000-\u0008]/.test(v))throw fail(400,'Invalid sale text.');s[k]=v.trim(); }
  }
  for(const k of ['job_name','builder','address','supplier','quote_ref','scope'])if(!s[k])throw fail(400,`Enter ${k.replaceAll('_',' ')}.`);
  if(s.sale_price<=0||s.supplier_payable<=0)throw fail(400,'Supplier payable and customer sale must be greater than zero.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s.eta_date)||!Number.isFinite(Date.parse(s.eta_date+'T00:00:00Z'))||new Date(s.eta_date+'T00:00:00Z').toISOString().slice(0,10)!==s.eta_date)throw fail(400,'Enter a valid ETA date.');
  if(!['estimate','supplier_confirmed'].includes(s.eta_basis))throw fail(400,'Choose whether the ETA is estimated or supplier-confirmed.');
  if(s.eta_basis==='supplier_confirmed'&&!s.order_number)throw fail(400,'A supplier-confirmed ETA needs its order number.');
  if(s.contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contact_email))throw fail(400,'Check the contact email.');
  return s;
}
export function saleFigures(s){
  const inputs={material_true_cost:s.material_true_cost,labor_cost_sub_pay:s.labor_cost_sub_pay,labor_sell_price:s.labor_sell_price,additional_install_material:s.additional_install_material,additional_equipment:s.additional_equipment,actual_total_sell:s.sale_price};
  const rough=roundMoney(s.labor_cost_sub_pay+s.additional_install_material+s.additional_equipment);
  return {inputs,computed:computeJobBudget(inputs),rough,profit:roundMoney(s.sale_price-s.supplier_payable-rough)};
}
export function etaBody(s,job,po,id){
  const end=new Date(s.eta_date+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);
  const link=`https://gfglassforge.com/jobs/${job.id}`;
  const order=s.order_number||'Not assigned yet';
  return {id,summary:`ETA - ${job.canonical_name} (${po.po_number})`,location:job.address,
    start:{date:s.eta_date},end:{date:end.toISOString().slice(0,10)},
    description:[`English`,`Supplier: ${s.supplier}`,`AMSCO / supplier order #: ${order}`,`ETA: ${s.eta_date} (${s.eta_basis==='estimate'?'owner estimate, not confirmed ready':'supplier-confirmed estimate'})`,`Arrival reminder only. No pickup, delivery or installation booked.`,`Job: ${link}`,'',`Español`,`Proveedor: ${s.supplier}`,`Número de pedido AMSCO / proveedor: ${s.order_number||'Aún no asignado'}`,`Llegada estimada: ${s.eta_date} (${s.eta_basis==='estimate'?'estimación del propietario, disponibilidad sin confirmar':'estimación confirmada por el proveedor'})`,`Solo recordatorio de llegada. No se ha programado recogida, entrega ni instalación.`,`Trabajo: ${link}`].join('\n'),
    extendedProperties:{private:{hubJobId:job.id,hubPurchaseOrderId:po.id,newSaleRequest:id}}};
}
export function sameEta(actual,expected){return actual?.status!=='cancelled'&&actual?.summary===expected.summary&&actual?.location===expected.location&&actual?.description===expected.description&&actual?.start?.date===expected.start.date&&actual?.end?.date===expected.end.date&&actual?.extendedProperties?.private?.hubJobId===expected.extendedProperties.private.hubJobId&&actual?.extendedProperties?.private?.hubPurchaseOrderId===expected.extendedProperties.private.hubPurchaseOrderId;}
export async function ensureEta(transport,body){
  const found=await transport.getEvent(body.id);
  if(found.kind==='found')return sameEta(found.event,body)?{state:'complete',event:found.event}:{state:'blocked',message:'ETA event was changed or cancelled. Review it; it was not overwritten or recreated.'};
  if(found.kind!=='not_found')return {state:'pending',message:'Could not verify the ETA calendar. Retry this same sale; do not create another job.'};
  await transport.insertEvent(body);
  const after=await transport.getEvent(body.id);
  return after.kind==='found'&&sameEta(after.event,body)?{state:'complete',event:after.event}:{state:'pending',message:'ETA save is unverified. Retry this same sale; no second calendar event will be created.'};
}

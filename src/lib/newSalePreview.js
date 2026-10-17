// Pure preview twin of newSaleCore.mjs; parity tested. No writes.
import {computeJobBudget,roundMoney} from './purchasingCoreTwin.js';
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

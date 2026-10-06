import { LegacyPurchasingRedirect } from './Procurement';

// Old PO links open the Orders section; existing PO data and numbers are retained.
export default function PurchaseOrders() {
  return <LegacyPurchasingRedirect section="orders" />;
}

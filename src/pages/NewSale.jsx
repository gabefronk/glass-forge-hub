import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';
import {isPurchasingMoneyOwner} from '@/lib/purchasingMoneyAccess';
import NewSaleForm from '@/components/new-sale/NewSaleForm';
import PageNotFound from '@/lib/PageNotFound';
export default function NewSale(){
 const {user}=useAuth();if(!isPurchasingMoneyOwner(user))return <PageNotFound/>;
 let initial;try{initial=JSON.parse(sessionStorage.getItem('new-sale-payload')||'null');}catch{initial=null;}
 return <NewSaleForm initial={initial} onSubmit={async b=>{const r=await base44.functions.invoke('newSale',b);const d=r?.data??r;if(d.error)throw new Error(d.error);return d;}}/>;
}

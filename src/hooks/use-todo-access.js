import {useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {isAgentCenterOwner} from '@/lib/agentCenterAccess';
// Navigation is convenience only; the todos backend enforces every read and write.
// The owner always sees the entry so a failed access check shows its error on the
// To-do page instead of silently hiding the whole feature.
export function useTodoAccess(user){
 const [access,setAccess]=useState({user_id:null,allowed:false});
 useEffect(()=>{
  let active=true;
  setAccess({user_id:user?.id||null,allowed:false});
  if(user?.id)base44.functions.invoke('todos',{action:'access'}).then(r=>{
   if(active)setAccess({user_id:user.id,allowed:r.data?.allowed===true});
  }).catch(()=>{});
  return()=>{active=false;};
 },[user?.id]);
 return isAgentCenterOwner(user)||(access.user_id===user?.id&&access.allowed);
}

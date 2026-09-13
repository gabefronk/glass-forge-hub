import {useEffect, useState} from "react";
import {LockKeyhole, RefreshCw} from "lucide-react";
import {base44} from "@/api/base44Client";
import {useAuth} from "@/lib/AuthContext";
import {isAgentCenterOwner} from "@/lib/agentCenterAccess";
import SystemMapExplorer from "@/components/system-map/SystemMapExplorer";
export default function SystemMap(){
  const {user}=useAuth();
  const owner=isAgentCenterOwner(user);
  const [data,setData]=useState(null);
  const [error,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let canceled=false;
    setData(null);setError("");
    if(owner)base44.functions.invoke("system-map",{}).then(result=>{
      if(!canceled){
        if(!Array.isArray(result.data?.nodes)||!Array.isArray(result.data?.edges)||!result.data?.views?.length)throw new Error("Map unavailable");
        setData(result.data);
      }
    }).catch(()=>{if(!canceled)setError("Your system map could not be loaded. Try again in a moment.");});
    return()=>{canceled=true;};
  },[owner,attempt]);
  if(!owner)return <section className="mx-auto max-w-lg p-8"><LockKeyhole className="mb-4 h-6 w-6 text-slate-500"/><h1 className="text-xl font-semibold">Owner access required</h1><p className="mt-2 text-sm text-slate-600">This system map is private to your Glass Forge owner account.</p></section>;
  if(error)return <section className="mx-auto max-w-lg p-8"><h1 className="text-xl font-semibold">System map</h1><p role="alert" className="my-4 text-sm text-slate-600">{error}</p><button type="button" onClick={()=>setAttempt(n=>n+1)} className="flex min-h-11 items-center gap-2 rounded-xl border bg-white px-4"><RefreshCw size={16}/>Try again</button></section>;
  if(!data)return <div role="status" className="p-8 text-slate-600">Loading your system map…</div>;
  return <SystemMapExplorer data={data}/>;
}

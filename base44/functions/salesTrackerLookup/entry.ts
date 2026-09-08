import { createClientFromRequest } from "npm:@base44/sdk";
Deno.serve(async(req)=>{
 const client=createClientFromRequest(req);
 const user=await client.auth.me().catch(()=>null);
 if(user?.role!=="admin") return Response.json({error:"Administrator access required."},{status:403});
 try {
  const query=await req.json();
  const snapshot=(await client.asServiceRole.entities.SalesTrackerSnapshot.filter({status:"validated"},"-source_captured_at",1))[0];
  if(!snapshot) return Response.json({status:"empty",matches:[],total:0});
  const norm=v=>String(v??"").trim().replace(/\s+/g," ").toLowerCase();
  const keys=["builder","subdivision","lot","oe","po"].filter(k=>norm(query[k]));
  const matches=keys.length?snapshot.rows.filter(r=>keys.every(k=>norm(r[k])===norm(query[k]))):[];
  const stale=Date.now()-new Date(snapshot.source_captured_at).getTime()>26*3600000;
  return Response.json({status:stale?"stale":"available",filename:snapshot.filename,
    source_captured_at:snapshot.source_captured_at,imported_at:snapshot.imported_at,
    row_count:snapshot.row_count,sheet_names:snapshot.sheet_names,sha256:snapshot.sha256,
    matches:matches.slice(0,100),total:matches.length,truncated:matches.length>100,
    note:"Arrival dates are source estimates, not proof of delivery or installation."});
 }catch(error){return Response.json({error:"Tracker lookup failed."},{status:500});}
});
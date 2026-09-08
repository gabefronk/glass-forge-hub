import { createClientFromRequest } from "npm:@base44/sdk";
import * as XLSX from "npm:xlsx@0.18.5";
import {parseTracker} from "./parser.js";
Deno.serve(async(req)=>{
 const client=createClientFromRequest(req);
 const user=await client.auth.me().catch(()=>null);
 if(user?.role!=="admin") return Response.json({error:"Administrator access required."},{status:403});
 let stage="load snapshot";
 try {
  const query=await req.json();
  const snapshot=(await client.asServiceRole.entities.SalesTrackerSnapshot.filter({status:"validated"},"-source_captured_at",1))[0];
  if(!snapshot) return Response.json({status:"empty",matches:[],total:0});
  const norm=v=>String(v??"").trim().replace(/\s+/g," ").toLowerCase();
  const keys=["builder","subdivision","lot","oe","po"].filter(k=>norm(query[k]));
  let rows=[];
  if(keys.length){
   stage="create private download link";
   const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:snapshot.file_uri,expires_in:300});
   stage="download private workbook";
   if(!signed_url) throw Error("Missing signed URL");
   const response=await fetch(signed_url);
   if(!response.ok) throw Error("Private workbook unavailable.");
   const bytes=new Uint8Array(await response.arrayBuffer());
   stage="verify workbook checksum";
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
   if(sha!==snapshot.sha256) throw Error("Workbook integrity check failed.");
   stage="parse workbook";
   rows=parseTracker(XLSX,bytes).rows;
  }
  const matches=keys.length?rows.filter(r=>keys.every(k=>norm(r[k])===norm(query[k]))):[];
  const stale=Date.now()-new Date(snapshot.source_captured_at).getTime()>26*3600000;
  return Response.json({status:stale?"stale":"available",filename:snapshot.filename,
    source_captured_at:snapshot.source_captured_at,imported_at:snapshot.imported_at,
    row_count:snapshot.row_count,sheet_names:snapshot.sheet_names,sha256:snapshot.sha256,
    matches:matches.slice(0,100),total:matches.length,truncated:matches.length>100,
    note:"Arrival dates are source estimates, not proof of delivery or installation."});
 }catch(error){return Response.json({error:"Tracker lookup failed during "+stage+"."},{status:500});}
});
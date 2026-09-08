import { createClientFromRequest } from "npm:@base44/sdk";
import * as XLSX from "npm:xlsx@0.18.5";
import { parseTracker } from "./parser.js";

Deno.serve(async(req)=>{
 const client=createClientFromRequest(req);
 const user=await client.auth.me().catch(()=>null);
 if(user?.role!=="admin") return Response.json({error:"Administrator access required."},{status:403});
 try {
  const body=await req.json();
  if(typeof body.file_base64!=="string" || body.file_base64.length>7000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.file_base64)) throw Error("Upload an Excel workbook up to 5 MB.");
  if(!/\.xlsx$/i.test(body.filename||"")) throw Error("Only .xlsx workbooks are supported.");
  const bytes=Uint8Array.from(atob(body.file_base64),c=>c.charCodeAt(0));
  if(bytes.length<100 || bytes.length>5000000 || bytes[0]!==80 || bytes[1]!==75) throw Error("Invalid Excel workbook.");
  const captured=new Date(body.source_captured_at);
  if(!Number.isFinite(captured.getTime()) || captured.getTime()>Date.now()+300000) throw Error("A valid source capture time is required.");
  const parsed=parseTracker(XLSX,bytes);
  const entity=client.asServiceRole.entities.SalesTrackerSnapshot;
  const latest=(await entity.filter({status:"validated"},"-source_captured_at",1))[0];
  if(latest && captured.getTime()<new Date(latest.source_captured_at).getTime()) throw Error("This snapshot is older than the current source. Current data was preserved.");
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if(latest?.sha256===sha && latest.source_captured_at===captured.toISOString()) return Response.json({id:latest.id,row_count:latest.row_count,unchanged:true});
  const {file_uri}=await client.integrations.Core.UploadPrivateFile({file:new File([bytes],body.filename,{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})});
  if(!file_uri) throw Error("Private file upload did not return a file reference.");
  // One immutable insert publishes the complete validated snapshot. Failed parses never replace current data.
  const saved=await entity.create({filename:body.filename,sha256:sha,
    imported_at:new Date().toISOString(),source_captured_at:captured.toISOString(),
    source_path:"Window Master / Window Folders / Outside Sales Reps / Gabe Customers / SALES TRACKER.xlsx",
    status:"validated",row_count:parsed.rows.length,sheet_names:parsed.sheet_names,file_uri});
  return Response.json({id:saved.id,row_count:parsed.rows.length,sheet_names:parsed.sheet_names,sha256:sha});
 } catch(error) {return Response.json({error:error.message||"Import failed. Previous snapshot preserved."},{status:400});}
});
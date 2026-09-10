import { createClientFromRequest } from "npm:@base44/sdk";
import * as XLSX from "npm:xlsx@0.18.5";
import { readTrackerView, trackerSha } from "../../shared/salesTrackerView.js";
import { TRACKER_FIELDS, trackerViewSignature } from "../../shared/salesTrackerAppend.js";
Deno.serve(async(req)=>{
 const client=createClientFromRequest(req),user=await client.auth.me().catch(()=>null);
 if(user?.role!=="admin")return Response.json({error:"Administrator access required."},{status:403});
 try{
  const query=await req.json(),current=await readTrackerView(client,XLSX),{snapshot,rows,appended}=current;
  const norm=v=>String(v??"").trim().replace(/\s+/g," ").toLowerCase();
  const keys=["builder","subdivision","lot","oe","po"].filter(k=>norm(query[k]));
  if(query.sheet){
   if(!["DAILY SALES","JOB SCHEDULE"].includes(query.sheet))throw Error("Unsupported worksheet.");
   const lib=XLSX.default||XLSX,workbook=lib.read(current.bytes,{type:"array"}),sheet=workbook.Sheets[query.sheet];
   if(!sheet)throw Error("Worksheet missing.");
   const range=lib.utils.decode_range(sheet["!ref"]||"A1");
   if(range.e.r>50000||range.e.c>300)throw Error("Worksheet too large.");
   const extra=query.sheet==="DAILY SALES"?appended:[],baseCount=range.e.r+1,total=baseCount+extra.length;
   const start=Math.max(0,Math.min(total-1,Math.floor(Number(query.start)||0))),end=Math.min(total,start+100),grid=[];
   for(let r=start;r<end;r++){
    if(r<baseCount){
     const cells=Array.from({length:range.e.c+1},(_,c)=>{const cell=sheet[lib.utils.encode_cell({r,c})];return cell?String(cell.w??lib.utils.format_cell(cell)??""):"";});
     grid.push({row:r+1,cells});
    }else{
     const row=extra[r-baseCount],cells=Array.from({length:range.e.c+1},(_,c)=>c<TRACKER_FIELDS.length?String(row[TRACKER_FIELDS[c]]??""):"");
     grid.push({row:r+1,cells,source_file:row.source_file,source_row:row.source_row,appended:true});
    }
   }
   return Response.json({sheet:query.sheet,columns:Array.from({length:range.e.c+1},(_,c)=>lib.utils.encode_col(c)),grid,total_rows:total,start,end,source_captured_at:snapshot.source_captured_at,appended_rows:extra.length});
  }
  const matches=keys.length?rows.filter(row=>keys.every(key=>norm(row[key])===norm(query[key]))):[];
  const stale=Date.now()-new Date(snapshot.source_captured_at).getTime()>26*3600000;
  return Response.json({status:stale?"stale":"available",filename:snapshot.filename,source_captured_at:snapshot.source_captured_at,imported_at:snapshot.imported_at,
   row_count:rows.length,baseline_row_count:current.base.rows.length,appended_count:appended.length,append_conflict_count:current.conflicts.length,
   latest_append_at:current.batches.reduce((date,batch)=>batch.imported_at>date?batch.imported_at:date,"")||null,
   sheet_names:snapshot.sheet_names,sha256:snapshot.sha256,view_version:await trackerSha(new TextEncoder().encode(trackerViewSignature(rows))),
   matches:matches.slice(0,100),total:matches.length,truncated:matches.length>100,
   note:"Arrival dates are source estimates. Incremental rows retain their source file; the original workbook is unchanged."});
 }catch(error){
  if(error.message?.includes("complete baseline workbook"))return Response.json({status:"empty",matches:[],total:0});
  return Response.json({error:"Tracker lookup failed. "+(error.message||"Please try again.")},{status:500});
 }
});

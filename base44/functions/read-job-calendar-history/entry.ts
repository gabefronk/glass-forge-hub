import {createClientFromRequest} from "npm:@base44/sdk";
Deno.serve(async req=>{
 const c=createClientFromRequest(req),u=await c.auth.me().catch(()=>null);
 if(u?.role!=="admin")return Response.json({error:"Administrator access required."},{status:403});
 try{
  // Read-only verification of the specific job requested by the user.
  const {accessToken}=await c.asServiceRole.connectors.getConnection("googlecalendar");
  const url=new URL("https://www.googleapis.com/calendar/v3/calendars/"+encodeURIComponent("iryedra@gmail.com")+"/events");
  url.searchParams.set("q","Dimple");url.searchParams.set("timeMin","2026-08-01T00:00:00-06:00");url.searchParams.set("timeMax","2026-09-22T00:00:00-06:00");url.searchParams.set("singleEvents","true");url.searchParams.set("maxResults","100");url.searchParams.set("orderBy","startTime");
  const entries=[];let pages=0;
  do{
   const r=await fetch(url,{headers:{Authorization:"Bearer "+accessToken}});
   if(!r.ok)return Response.json({error:"The live calendar could not be read.",provider_status:r.status},{status:502});
   const d=await r.json();
   entries.push(...(d.items||[]).map(e=>({source_id:e.id,job_name:e.summary||"",start:e.start,end:e.end,status:e.status,location:e.location||"",notes:e.description||"",updated:e.updated})));
   pages++;if(!d.nextPageToken)break;if(pages>=10)throw Error("Incomplete result");url.searchParams.set("pageToken",d.nextPageToken);
  }while(true);
  return Response.json({read_only:true,calendar:"Israel calendar",search:"Dimple",range_start:"2026-08-01",range_end:"2026-09-21",checked_at:new Date().toISOString(),entries,count:entries.length,note:"Live source search results. No events, invoices or messages were changed. Verify job identity before linking a result."});
 }catch{return Response.json({error:"Live history verification is unavailable. Stored evidence remains available."},{status:500});}
});

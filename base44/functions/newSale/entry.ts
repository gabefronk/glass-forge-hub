import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { newSaleAction } from '../../shared/newSaleService.mjs';
import { createGoogleTransport } from '../../shared/jobCalendarGoogleTransport.js';
import { CREW_CALENDAR } from '../../shared/jobCalendarCore.js';
export default async function(req:Request){
 const base44=createClientFromRequest(req);
 try{
  const user=await base44.auth.me();const body=await req.json();
  const transport=createGoogleTransport({calendar:CREW_CALENDAR,fetch,getToken:async()=>{const {accessToken}=await base44.asServiceRole.connectors.getConnection('googlecalendar');return accessToken;}});
  const sha256=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  return Response.json(await newSaleAction(base44.asServiceRole.entities,body,user,{transport,sha256}),{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e.message,uncertain:e.uncertain===true},{status:e.status||500,headers:{'Cache-Control':'no-store'}});}
}

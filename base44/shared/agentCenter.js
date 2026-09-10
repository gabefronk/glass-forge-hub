export const AGENT_CENTER_OWNER = 'gabefronk@gmail.com';
export const isAgentCenterOwner = user => user?.role === 'admin' && String(user.email||'').trim().toLowerCase() === AGENT_CENTER_OWNER;
const clean = (value,max=180) => typeof value === 'string' ? value.slice(0,max) : '';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export function buildAgentInventory({workers=[],snapshot=null,now=new Date()}={}) {
 const items=[
  {id:'sales_tracker_agent',name:'Sales Tracker agent',provider:'Base44',host:'Glass Forge cloud',connection:'connected',status:'On demand',
   assignment:'Look up exact orders and lot-specific arrival estimates.',updated_at:null,data_updated_at:date(snapshot?.source_captured_at),allowed_actions:['Open Tracker','Save a private entry'],url:'/sales-tracker',
   evidence:'Configured Base44 agent using the read-only salesTrackerLookup function. No background-run heartbeat.'},
  {id:'calendar_coordinator',name:'Calendar coordinator',provider:'Base44',host:'Glass Forge cloud',connection:'connected',status:'On demand',
   assignment:'Review job evidence and reconcile captured installation schedules.',updated_at:null,allowed_actions:['Open Calendar','Save a private entry'],url:'/calendar',
   evidence:'Configured Base44 agent with read-only job and calendar tools. No message delivery or calendar writes.'},
  {id:'mac_manager',name:'MacBook manager workspace',provider:'Not connected',host:'MacBook',connection:'manual',status:'Status unverified',
   assignment:'Manager review and source capture coordination.',updated_at:null,allowed_actions:['Save a private entry'],url:null,
   evidence:'Workspace requested by the owner. A signed API or webhook connection is needed for live status, dispatch and results.'},
  {id:'codex_development',name:'Glass Forge development workspace',provider:'Codex',host:'Windows',connection:'manual',status:'Status unverified',
   assignment:'App improvements and AMSCO pricing coverage.',updated_at:null,allowed_actions:['Save a private entry'],url:null,
   evidence:'Local development workspace. This page cannot read or control Codex tasks without a connected API.'}
 ];
 for(const worker of workers){
  const seen=date(worker.last_seen_at),age=seen?now.getTime()-Date.parse(seen):Infinity,fresh=age>=-60000&&age<=600000;
  const phase=worker.runner_presence?.runner_status;
  const status=!worker.enabled?'Disabled':!fresh?'Check-in stale':phase==='attention'?'Needs attention':worker.active_quote_id?'Working':'Checked in';
  const quote=clean(worker.active_quote_id,80),id=clean(worker.id,80);
  if(!/^[a-zA-Z0-9_-]+$/.test(id))continue;
  items.push({id:'worker:'+id,name:clean(worker.name)||'Paired quote runner',provider:'Glass Forge quote runner',host:'Paired computer',connection:'connected',status,
   assignment:quote?'Saved quote '+quote:'Window pricing queue',updated_at:seen,allowed_actions:['Open Window Quotes','Save a private entry'],
   url:quote&&/^[a-zA-Z0-9_-]+$/.test(quote)?'/window-quotes?quote='+encodeURIComponent(quote):'/window-quotes',
   evidence:'Registered runner check-ins only. No start, stop, remote control or credential access is exposed here.'});
 }
 return items;
}
function publicEntry(entry) {return {id:entry.id,target_id:entry.target_id,kind:entry.kind,title:entry.title,body:entry.body,recorded_at:entry.recorded_at,actor_email:entry.actor_email,status:entry.status,request_key:entry.request_key};}
export function createAgentCenterHandler({getClient,now=()=>new Date()}) {
 return async req=>{
  if(req.method!=='POST')return Response.json({error:'Use POST.'},{status:405});
  const client=await getClient(req),user=await client.auth.me().catch(()=>null);
  if(!isAgentCenterOwner(user))return Response.json({error:'This section is private to the Glass Forge owner.'},{status:403});
  try {
   const input=await req.json(),api=client.asServiceRole.entities;
   if(input.action==='entry'){
    if(!['request','note','result'].includes(input.kind))throw Error('Choose request, note or result.');
    const title=clean(input.title,161).trim(),body=clean(input.body,5001).trim(),target=clean(input.target_id,120);
    if(!title||title.length>160||!body||body.length>5000)throw Error('Use a title up to 160 characters and entry text up to 5,000 characters.');
    if(!['sales_tracker_agent','calendar_coordinator','mac_manager','codex_development'].includes(target)&&!/^worker:[a-zA-Z0-9_-]{1,80}$/.test(target))throw Error('Choose a workspace from the inventory.');
    if(typeof input.request_key!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(input.request_key))throw Error('The save identifier is missing. Refresh and try again.');
    if(target.startsWith('worker:')&&!(await api.QuoteWorkers.filter({id:target.slice(7)},'-updated_date',1)).length)throw Error('That runner is no longer registered.');
    const prior=(await api.AgentCenterEntry.filter({request_key:input.request_key},'-recorded_at',1))[0];
    if(prior){
     if(prior.target_id!==target||prior.kind!==input.kind||prior.title!==title||prior.body!==body)return Response.json({error:'This save identifier was used for different text. Start a new entry.'},{status:409});
     return Response.json({entry:publicEntry(prior),unchanged:true});
    }
    const saved=await api.AgentCenterEntry.create({request_key:input.request_key,target_id:target,kind:input.kind,title,body,recorded_at:now().toISOString(),actor_email:user.email,
     status:input.kind==='request'?'saved_for_manual_review':input.kind==='result'?'owner_recorded_result':'private_note'});
    return Response.json({entry:publicEntry(saved),delivery:'Not dispatched. This is a private saved entry.'});
   }
   if(input.action!=='inventory')throw Error('Unsupported Agent Center action.');
   const results=await Promise.allSettled([
    api.QuoteWorkers.list('-last_seen_at',100),
    api.SalesTrackerSnapshot.filter({status:'validated'},'-source_captured_at',1),
    api.AgentCenterEntry.list('-recorded_at',101)
   ]);
   const workers=results[0].status==='fulfilled'?results[0].value:[],snapshot=results[1].status==='fulfilled'?results[1].value[0]:null,entries=results[2].status==='fulfilled'?results[2].value:[];
   const warnings=results.map((r,i)=>r.status==='rejected'?['Runner check-ins are unavailable.','Tracker capture information is unavailable.','Private activity could not be loaded.'][i]:null).filter(Boolean);
   return Response.json({inventory:buildAgentInventory({workers,snapshot,now:now()}),entries:entries.slice(0,100).map(publicEntry),has_more_entries:entries.length>100,warnings,checked_at:now().toISOString(),
    dispatch_enabled:false});
  }catch(error){return Response.json({error:error.message||'Agent Center could not finish this action.'},{status:400});}
 };
}

export const AGENT_CENTER_OWNER = 'gabefronk@gmail.com';
export const isAgentCenterOwner = user => user?.role === 'admin' && String(user.email||'').trim().toLowerCase() === AGENT_CENTER_OWNER;
const clean=(value,max=180)=>typeof value==='string'?value.slice(0,max):'';
const iso=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const ids=new Set(['manager_agent','sales_tracker_agent','calendar_coordinator','probuild_reporting','codex_development','mac_manager']);
const visibleEntry=entry=>({id:entry.id,target_id:entry.target_id,kind:entry.kind,title:entry.title,body:entry.body,recorded_at:entry.recorded_at,actor_email:entry.actor_email,status:entry.status,request_key:entry.request_key});
const visibleEscalation=row=>({id:row.id,agent_id:row.agent_id,department:row.department,title:row.title,context:row.context,status:row.status,created_at:row.created_at,resolved_at:row.resolved_at,resolution:row.resolution});
const baseNodes=[
 {id:'manager_agent',name:'Glass Forge manager',department:'Operations leadership',parent_id:null,provider:'Base44 policy layer',host:'Glass Forge cloud',connection:'planned',status:'Escalates unknown decisions',assignment:'Coordinates only documented routing and record-keeping policies. It does not send, purchase, schedule, import, or control external systems.',capabilities:['Route approved work','Record status','Create owner escalations'],handoffs:['All departments'],url:null},
 {id:'sales_tracker_agent',name:'Sales Tracker agent',department:'Sales data',parent_id:'manager_agent',provider:'Base44',host:'Glass Forge cloud',connection:'connected',status:'On demand',assignment:'Looks up exact orders and lot-specific arrival estimates.',capabilities:['Read Sales Tracker','Record findings'],handoffs:['Calendar coordinator','Glass Forge manager'],url:'/sales-tracker'},
 {id:'calendar_coordinator',name:'Calendar coordinator',department:'Scheduling',parent_id:'manager_agent',provider:'Base44',host:'Glass Forge cloud',connection:'connected',status:'On demand',assignment:'Reviews job evidence and reconciles captured installation schedules.',capabilities:['Review calendar evidence','Record findings'],handoffs:['ProBuild reporting','Glass Forge manager'],url:'/calendar'},
 {id:'probuild_reporting',name:'ProBuild reporting',department:'Field operations',parent_id:'manager_agent',provider:'Not connected',host:'ProBuild',connection:'planned',status:'Connection planned',assignment:'Future read-only collection of job posts, photos, notes, and report status.',capabilities:['Planned: read job data'],handoffs:['Calendar coordinator','Glass Forge manager'],url:null},
 {id:'codex_development',name:'Glass Forge development',department:'Product engineering',parent_id:'manager_agent',provider:'Codex',host:'Development computer',connection:'manual',status:'Status unverified',assignment:'App improvements and AMSCO pricing coverage.',capabilities:['Manual status updates'],handoffs:['Glass Forge manager'],url:null},
 {id:'mac_manager',name:'MacBook manager workspace',department:'Operations leadership',parent_id:'manager_agent',provider:'Not connected',host:'MacBook',connection:'manual',status:'Status unverified',assignment:'Source capture and manager review coordination.',capabilities:['Manual status updates'],handoffs:['Glass Forge manager'],url:null},
 {id:'external_claude_agents',name:'External Claude agents',department:'Product engineering',parent_id:'manager_agent',provider:'Anthropic Claude',host:'External connection',connection:'planned',status:'Connection planned',assignment:'Future Claude agents can report status through the shared event interface after an authorized API, MCP, or webhook connection is configured.',capabilities:['Planned: status events only'],handoffs:['Glass Forge manager'],url:null}
];
export function buildAgentInventory({workers=[],snapshot=null,events=[],now=new Date()}={}) {
 const latest=new Map();
 for(const row of events){if(!latest.has(row.agent_id))latest.set(row.agent_id,row);}
 const dataTime=iso(snapshot?.source_captured_at);
 return baseNodes.map(node=>{
  const event=latest.get(node.id);
  const status=event?.event_type==='needs_owner_decision'?'Needs your decision':event?.event_type==='failed'?'Failed':event?.event_type==='completed'?'Completed':event?.event_type==='progress'?'Working':event?.event_type==='started'?'Started':node.status;
  return {...node,status,updated_at:iso(event?.occurred_at),latest_update:clean(event?.message,500)||null,data_updated_at:node.id==='sales_tracker_agent'?dataTime:null};
 });
}
export function createAgentCenterHandler({getClient,now=()=>new Date()}={}) {
 return async req=>{
  if(req.method!=='POST')return Response.json({error:'Use POST.'},{status:405});
  const client=await getClient(req),user=await client.auth.me().catch(()=>null);
  if(!isAgentCenterOwner(user))return Response.json({error:'This section is private to the Glass Forge owner.'},{status:403});
  try{
   const input=await req.json(),api=client.asServiceRole.entities,at=now().toISOString();
   if(input.action==='entry'){
    if(!['request','note','result'].includes(input.kind))throw Error('Choose request, note or result.');
    const target=clean(input.target_id,80),title=clean(input.title,161).trim(),body=clean(input.body,5001).trim(),requestKey=clean(input.request_key,100);
    if(!ids.has(target)||!title||title.length>160||!body||body.length>5000||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey))throw Error('Use a listed agent and provide a valid title, details, and save identifier.');
    const prior=(await api.AgentCenterEntry.filter({request_key:requestKey},'-recorded_at',1))[0];
    if(prior){if(prior.target_id!==target||prior.kind!==input.kind||prior.title!==title||prior.body!==body)return Response.json({error:'This save identifier was used for different text. Start a new entry.'},{status:409});return Response.json({entry:visibleEntry(prior),unchanged:true});}
    const saved=await api.AgentCenterEntry.create({request_key:requestKey,target_id:target,kind:input.kind,title,body,recorded_at:at,actor_email:user.email,status:input.kind==='request'?'saved_for_manual_review':input.kind==='result'?'owner_recorded_result':'private_note'});
    let escalation=null;
    if(input.kind==='request'){
      const node=baseNodes.find(item=>item.id===target);
      escalation=await api.AgentCenterEscalation.create({escalation_key:'entry:'+saved.id,source_entry_id:saved.id,agent_id:target,department:node?.department||'Unassigned',title,context:body,status:'needs_owner_decision',created_at:at});
    }
    return Response.json({entry:visibleEntry(saved),escalation:escalation&&visibleEscalation(escalation),delivery:'Not dispatched. Requests wait for the owner decision queue.'});
   }
   if(input.action==='resolve_escalation'){
    const id=clean(input.escalation_id,100),resolution=clean(input.resolution,5001).trim();
    if(!id||!resolution)throw Error('Select an escalation and provide a resolution.');
    const rows=await api.AgentCenterEscalation.filter({id},'-created_at',1),row=rows[0];
    if(!row||row.status!=='needs_owner_decision')throw Error('That escalation is no longer open.');
    const updated=await api.AgentCenterEscalation.update(id,{status:'answered',resolution,resolved_at:at});
    return Response.json({escalation:visibleEscalation(updated),dispatch_enabled:false});
   }
   if(input.action==='event'){
    const agent=clean(input.agent_id,80),eventType=clean(input.event_type,80),message=clean(input.message,1001).trim(),eventKey=clean(input.event_key,100);
    if(!ids.has(agent)||!['started','progress','needs_owner_decision','completed','failed'].includes(eventType)||!message||!/^[a-zA-Z0-9_-]{16,100}$/.test(eventKey))throw Error('Use a registered agent and valid event details.');
    const prior=(await api.AgentCenterEvent.filter({event_key:eventKey},'-occurred_at',1))[0];
    if(prior)return Response.json({event:prior,unchanged:true});
    const node=baseNodes.find(item=>item.id===agent);
    const event=await api.AgentCenterEvent.create({event_key:eventKey,agent_id:agent,event_type:eventType,message,occurred_at:at,connection_state:node.connection,recorded_by:user.email});
    return Response.json({event,dispatch_enabled:false});
   }
   if(input.action!=='inventory')throw Error('Unsupported Agent Center action.');
   const results=await Promise.allSettled([api.SalesTrackerSnapshot.filter({status:'validated'},'-source_captured_at',1),api.AgentCenterEntry.list('-recorded_at',101),api.AgentCenterEscalation.list('-created_at',101),api.AgentCenterEvent.list('-occurred_at',101)]);
   const [snapshot,entries,escalations,events]=[results[0].status==='fulfilled'?results[0].value[0]:null,results[1].status==='fulfilled'?results[1].value:[],results[2].status==='fulfilled'?results[2].value:[],results[3].status==='fulfilled'?results[3].value:[]];
   const warnings=results.map((r,i)=>r.status==='rejected'?['Tracker capture information is unavailable.','Private activity could not be loaded.','Escalations could not be loaded.','Agent events could not be loaded.'][i]:null).filter(Boolean);
   return Response.json({inventory:buildAgentInventory({snapshot,events,now:now()}),entries:entries.slice(0,100).map(visibleEntry),escalations:escalations.slice(0,100).map(visibleEscalation),has_more_entries:entries.length>100,checked_at:at,warnings,dispatch_enabled:false,event_interface:{supported_event_types:['started','progress','needs_owner_decision','completed','failed'],connection_states:['connected','manual','planned'],authentication:'A future signed integration bridge is required; this page stores no secrets.'}});
  }catch(error){return Response.json({error:error.message||'Agent Center could not finish this action.'},{status:400});}
 };
}
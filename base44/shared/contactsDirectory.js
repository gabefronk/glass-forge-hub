import {buildDirectory,matchingContacts,phoneKey,builderCatalog,contactPhoneKeys,contactEmailKeys} from './contactMatching.js';
import {jobContactsView,jobContactCoverage,eventsByJob,contactRole,LINK_ROLES} from './jobContacts.js';
import {CONTACT_LINK_SEEDS} from './contactLinkSeeds.js';
import {applyContactOverlay,activeContacts,resolveContact,planContactCleanup,applyCleanupItem} from './contactCleanup.js';
import {homeownerPrefill} from './jobHomeowner.js';
const JOB_VIEWS=new Set(['job_contacts','job_contact_coverage']);
const contactFields=(input)=>{const name=String(input.name||'').trim().replace(/\s+/g,' '),phone=String(input.phone||'').trim(),email=String(input.email||'').trim().toLowerCase(),company=String(input.company||'').trim(),builder=String(input.builder||'').trim();
 if(!name||name.length>150||[phone,email,company,builder].some(v=>v.length>200)||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||phone&&!phoneKey(phone))return null;
 return {name,phone,phone_key:phoneKey(phone),email,email_key:email,company,builder,note:'',review_note:'',source:'hub'};
};
const EMPTY_DIRECTORY={source:null,contacts:[],job_references:[]};
const owners=new Set(['gabefronk@gmail.com','gabriel.fronk.wd@gmail.com']);
const owner=u=>u?.role==='admin'&&owners.has(String(u.email||'').toLowerCase().trim());
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export const canonicalJson=value=>Array.isArray(value)?'['+value.map(canonicalJson).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}':JSON.stringify(value);
const response=(data,status=200)=>Response.json(data,{status});
async function all(entity,sort='-created_date'){const result=[];for(let skip=0;skip<50000;skip+=500){const page=await entity.list(sort,500,skip);result.push(...page);if(page.length<500)return result;}throw Error('Directory exceeds supported size.');}
// One contact per role per job: superintendent and homeowner are single slots on the job page.
const SINGLE_ROLES={superintendent:'set_job_super',homeowner:'set_job_homeowner'};
const ROLE_ACTIONS={job_super:'superintendent',job_homeowner:'homeowner'};
const OVERLAY_FIELDS=['phones','emails','aliases','merged_keys','role','builder','company','status','merged_into'];
const minimal=c=>c?{key:c.key,name:c.name,phone:c.phone||'',email:c.email||''}:null;
export function validateDirectory(data){
 if(data?.version!==1||!data.source||!Array.isArray(data.contacts)||!data.contacts.length||data.contacts.length>5000||!Array.isArray(data.job_references)||data.job_references.length>20000)throw Error('Invalid directory.');
 if(!/^[a-f0-9]{64}$/.test(data.source.workbook_sha256)||!Number.isFinite(Date.parse(data.source.captured_at)))throw Error('Source identity required.');
 const keys=new Set();
 for(const c of data.contacts){if(!/^[a-f0-9]{64}$/.test(c.key)||keys.has(c.key)||!c.name||!Number.isInteger(c.row)||c.row<2)throw Error('Invalid contact.');keys.add(c.key);for(const [k,v] of Object.entries(c))if(k!=='row'&&(typeof v!=='string'||v.length>2000))throw Error('Invalid contact field.');}
 for(const r of data.job_references){if(!Number.isInteger(r.row)||r.row<2||typeof r.builder!=='string'||!r.builder)throw Error('Invalid job reference.');for(const [k,v] of Object.entries(r))if(k!=='row'&&(typeof v!=='string'||v.length>2000))throw Error('Invalid job reference field.');}
 return data;
}
export function createContactsDirectoryHandler({getClient,fetchFile=fetch}={}){
 const cache=new Map();
 async function load(client,row){if(cache.has(row.content_sha256))return cache.get(row.content_sha256);if(row.directory_data){const text=canonicalJson(row.directory_data);if(await hash(text)!==row.content_sha256)throw Error('Checksum mismatch');const data=validateDirectory(row.directory_data);cache.clear();cache.set(row.content_sha256,data);return data;}const {signed_url}=await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:row.data_file_uri,expires_in:300});const r=await fetchFile(signed_url);if(!r.ok)throw Error('File unavailable');const text=await r.text();if(await hash(text)!==row.content_sha256)throw Error('Checksum mismatch');const data=validateDirectory(JSON.parse(text));cache.clear();cache.set(row.content_sha256,data);return data;}
 return async req=>{
  if(req.method!=='POST')return response({error:'Use POST.'},405);
  try{
   const client=await getClient(req),user=await client.auth.me().catch(()=>null);if(!user)return response({error:'Sign in required.'},401);
   const text=await req.text();if(text.length>5000000)return response({error:'Directory file is too large.'},413);
   const input=JSON.parse(text),api=client.asServiceRole.entities;
   // Crew can only search the minimum contact card fields needed by Add job, explicitly save a
   // chosen job link, and read / set the job's superintendent and homeowner (name, phone, email).
   // The private directory workspace and all import, coverage, cleanup, message and suggestion
   // actions remain owner-only.
   const crewAction=['picker','link','job_super','set_job_super','job_homeowner','set_job_homeowner'].includes(input.action);
   if(!owner(user)&&!crewAction)return response({error:'Owner access required.'},403);
   if(input.action==='import'){
    let data;try{data=validateDirectory(input.directory);}catch{return response({error:'This is not a valid contacts directory export.'},400);}
    const content=canonicalJson(data),digest=await hash(content);
    const existing=(await api.ContactDirectorySnapshot.filter({content_sha256:digest},'-created_date',1))[0];
    if(existing)return response({ok:true,duplicate:true,contacts:existing.contact_count,source:existing.filename});
    const {file_uri}=await client.asServiceRole.integrations.Core.UploadPrivateFile({file:new File([content],'contact-directory.json',{type:'application/json'})});if(!file_uri)throw Error('Upload failed');
    await api.ContactDirectorySnapshot.create({filename:data.source.filename,source_location:data.source.location,captured_at:data.source.captured_at,workbook_sha256:data.source.workbook_sha256,content_sha256:digest,data_file_uri:file_uri,contact_count:data.contacts.length,job_reference_count:data.job_references.length});
    cache.clear();cache.set(digest,data);return response({ok:true,contacts:data.contacts.length,source:data.source.filename});
   }
   const snapshot=(await api.ContactDirectorySnapshot.list('-created_date',1))[0];
   const hubRows=await all(api.HubContacts);
   const stored=snapshot?await load(client,snapshot):EMPTY_DIRECTORY;
   // Snapshot contacts with the owner's saved fixes applied, plus contacts added in the hub.
   // Merged-away contacts stay in `every` (to resolve old keys) but are hidden everywhere else.
   const every=applyContactOverlay(stored.contacts,hubRows),live=activeContacts(every);
   const data={...stored,contacts:live};
   // Anyone signed in can save the super or homeowner for one job (name, phone, email, or a
   // chosen contact): an existing contact with the same phone or email is reused, never duplicated.
   const setRole=Object.entries(SINGLE_ROLES).find(([,action])=>action===input.action)?.[0];
   if(setRole){
    const job=await api.Jobs.get(input.job_id).catch(()=>null);if(!job)return response({error:'Select an existing job.'},400);
    const prior=await api.ContactJobLink.filter({job_id:job.id,role:setRole},'-created_date',50);
    if(input.remove===true){for(const l of prior)await api.ContactJobLink.update(l.id,{role:''});return response({ok:true,[setRole==='superintendent'?'super':'homeowner']:null});}
    let contact=input.contact_key?resolveContact(every,String(input.contact_key)):null;
    if(input.contact_key&&!contact)return response({error:'Contact not found.'},404);
    if(!contact){
     const fields=contactFields(input.contact||{});if(!fields||!fields.phone_key&&!fields.email_key)return response({error:'Enter a name and a phone or email.'},400);
     contact=live.find(c=>fields.phone_key&&contactPhoneKeys(c).includes(fields.phone_key)||fields.email_key&&contactEmailKeys(c).includes(fields.email_key));
     if(!contact){
      // A new super is filed under the job's builder; a new homeowner is the job's customer side.
      if(setRole==='superintendent'&&!fields.builder){const b=builderCatalog(live.map(c=>c.builder)).find(job.builder)?.name||'';fields.builder=b;if(b&&!fields.company)fields.company=b+' - Super';}
      if(setRole==='homeowner'&&!fields.company)fields.company='Homeowner';
      const key=await hash(crypto.randomUUID());contact=await api.HubContacts.create({...fields,key,role:setRole});
     }
    }
    for(const l of prior)if(l.contact_key!==contact.key)await api.ContactJobLink.update(l.id,{role:''});
    const same=(await api.ContactJobLink.filter({contact_key:contact.key,job_id:job.id},'-created_date',1))[0];
    if(same){if(same.role!==setRole)await api.ContactJobLink.update(same.id,{role:setRole});}
    else await api.ContactJobLink.create({contact_key:contact.key,job_id:job.id,source:'manual',role:setRole});
    return response({ok:true,[setRole==='superintendent'?'super':'homeowner']:minimal(contact)});
   }
   if(input.action==='create_contact'){
    const fields=contactFields(input.contact||{});if(!fields)return response({error:'Enter a name and valid contact details.'},400);
    const same=live.filter(c=>fields.email_key&&contactEmailKeys(c).includes(fields.email_key)||fields.phone_key&&contactPhoneKeys(c).includes(fields.phone_key));
    if(same.length)return response({error:'A contact with this email or phone already exists. Choose it instead.',existing:same.map(c=>({key:c.key,name:c.name,company:c.company}))},409);
    // Random stable key: changing a name or phone later cannot rewrite existing job links.
    const role=LINK_ROLES.includes(input.contact?.role)?input.contact.role:'';
    const key=await hash(crypto.randomUUID());const created=await api.HubContacts.create({...fields,key,...(role?{role}:{})});
    return response({ok:true,contact:{key:created.key,name:created.name,company:created.company,phone:created.phone,email:created.email}},201);
   }
   // The job's saved super / homeowner, as a minimal card, for every signed-in user. The homeowner
   // view also offers the job's customer name as a starting point when nobody is saved yet.
   const readRole=ROLE_ACTIONS[input.action];
   if(readRole){
    const links=await api.ContactJobLink.filter({job_id:String(input.job_id||''),role:readRole},'-created_date',5);
    const c=links.map(l=>resolveContact(every,l.contact_key)).find(Boolean);
    if(readRole==='superintendent')return response({super:minimal(c)});
    const job=c?null:await api.Jobs.get(String(input.job_id||'')).catch(()=>null);
    return response({homeowner:minimal(c),prefill:c?null:homeownerPrefill(job)});
   }
   if(!snapshot&&!hubRows.length&&!JOB_VIEWS.has(input.action)&&input.action!=='picker'&&input.action!=='cleanup_plan')return response({empty:true,contacts:[],jobs:[],builders:[],summary:{contacts:0}});
   if(input.action==='picker')return response({contacts:live.map(({key,name,company,email,phone})=>({key,name,company:company||'',email:email||'',phone:phone||''}))});
   if(input.action==='contact'){const contact=resolveContact(every,input.contact_key);return contact?response({contact}):response({error:'Contact not found.'},404);}
   if(input.action==='link'){
    const target=resolveContact(every,input.contact_key);if(!target)return response({error:'Contact not found.'},404);
    const job=String(input.job_id||'').startsWith('workbook:')?buildDirectory(data,await all(api.Jobs)).jobs.find(j=>j.id===input.job_id):await api.Jobs.get(input.job_id).catch(()=>null);if(!job)return response({error:'Select an existing job.'},400);
    // Optional per-job role (e.g. superintendent) and provenance of an owner-confirmed suggestion.
    const role=input.role?String(input.role):'';if(role&&!LINK_ROLES.includes(role))return response({error:'Unsupported contact role.'},400);
    const query={contact_key:target.key,job_id:job.id};const prior=(await api.ContactJobLink.filter(query,'-created_date',1))[0];
    if(input.remove===true){if(prior)await api.ContactJobLink.delete(prior.id);}
    else if(!prior)await api.ContactJobLink.create({...query,source:input.source==='suggestion'?'suggestion':'manual',...(role?{role}:{})});
    else if(role&&prior.role!==role)await api.ContactJobLink.update(prior.id,{role});
    return response({ok:true});
   }
   const [jobs,links]=await Promise.all([all(api.Jobs),all(api.ContactJobLink)]);const directory=buildDirectory(data,jobs,links);
   if(input.action==='cleanup_plan'||input.action==='cleanup_apply'){
    let events=[];try{events=(await all(api.CalendarEvents)).filter(e=>/\b(spr|supt|super)/i.test(e.scope_notes||''));}catch{}
    const plan=planContactCleanup({contacts:[...directory.contacts,...every.filter(c=>c.status==='merged')],links,events,jobs:directory.jobs});
    if(input.action==='cleanup_plan')return response({...plan,builder_variants:directory.builder_variants||[]});
    // Owner-applied: only items still in a freshly computed plan are written, one at a time.
    const ids=Array.isArray(input.ids)?input.ids.map(String).slice(0,300):[];if(!ids.length)return response({error:'Choose at least one cleanup item.'},400);
    const byId=new Map(plan.items.map(i=>[i.id,i]));const applied=[],skipped=[],failed=[];
    const rows=new Map(hubRows.map(r=>[r.key,r]));
    const upsert=async(key,patch,base)=>{const row=rows.get(key);if(row){await api.HubContacts.update(row.id,patch);rows.set(key,{...row,...patch});return;}const created=await api.HubContacts.create({key,name:base.name,source:'override',...patch});rows.set(key,created);};
    const repoint=async(from,to)=>{for(const l of await api.ContactJobLink.filter({contact_key:from},'-created_date',500)){const dup=(await api.ContactJobLink.filter({contact_key:to,job_id:l.job_id},'-created_date',1))[0];if(!dup){await api.ContactJobLink.update(l.id,{contact_key:to});continue;}if(l.role&&!dup.role)await api.ContactJobLink.update(dup.id,{role:l.role});await api.ContactJobLink.delete(l.id);}};
    let current=[...directory.contacts,...every.filter(c=>c.status==='merged')];
    const merged=new Set();
    for(const id of ids){
     const item=byId.get(id);
     // Items touching a contact that an earlier item in this batch merged away are re-planned next time.
     const keys=item?[item.survivor?.key,item.contact?.key,...(item.merge||[]).map(m=>m.key)].filter(Boolean):[];
     if(!item||keys.some(k=>merged.has(k))){skipped.push(id);continue;}
     try{await applyCleanupItem(item,current,{upsert,repoint});applied.push(id);for(const m of item.merge||[])merged.add(m.key);current=current.map(c=>rows.has(c.key)?{...c,...Object.fromEntries(Object.entries(rows.get(c.key)).filter(([k,v])=>OVERLAY_FIELDS.includes(k)&&v!==undefined))}:c);}
     catch(e){failed.push({id,error:String(e?.message||'Could not apply.')});}
    }
    return response({ok:true,applied,skipped,failed});
   }
   if(JOB_VIEWS.has(input.action)){
    const one=input.action==='job_contacts',rawJob=one?jobs.find(j=>j.id===input.job_id):null;
    if(one&&!rawJob)return response({error:'Job not found.'},404);
    // Message threads are optional evidence; a failure only hides that source of suggestions.
    let conversations=[],messages='available',notes=[],events=[],sourceQuotes=[],feeLines=[];
    try{conversations=one?await api.MessageConversation.filter({job_id:rawJob.id},'-last_message_at',50):(await all(api.MessageConversation)).filter(c=>c.job_id);}catch{messages='unavailable';}
    try{notes=one?await api.JobNotes.filter({job_id:rawJob.id},'-note_date',100):await all(api.JobNotes);}catch{}
    // Calendar events reach a job by job_id, a billing line's calendar_event_id, or its exact name.
    try{
     if(one){
      feeLines=(await api.FeeLines.filter({job_id:rawJob.id},'-job_date',500)).filter(l=>l.calendar_event_id);
      const byId=await api.CalendarEvents.filter({job_id:rawJob.id},'-event_date',100);
      const byGoogle=(await Promise.all([...new Set(feeLines.map(l=>l.calendar_event_id))].slice(0,40).map(g=>api.CalendarEvents.filter({google_event_id:g},'-event_date',2).catch(()=>[])))).flat();
      const byName=(await Promise.all([...new Set([rawJob.canonical_name,...(rawJob.aliases||[])].filter(Boolean))].slice(0,8).map(n=>api.CalendarEvents.filter({job_name:n},'-event_date',50).catch(()=>[])))).flat();
      events=eventsByJob([...new Map([...byId,...byGoogle,...byName].map(e=>[e.id,e])).values()],jobs,feeLines).get(rawJob.id)||[];
     }else{
      const allEvents=await all(api.CalendarEvents);
      try{feeLines=(await all(api.FeeLines)).filter(l=>l.calendar_event_id);}catch{}
      const grouped=eventsByJob(allEvents,jobs,feeLines);events=[...grouped].flatMap(([id,list])=>list.map(e=>({...e,job_id:id})));
     }
    }catch{}
    try{if(one&&rawJob.source_window_quote_id)sourceQuotes=await api.QuoteRequests.filter({id:rawJob.source_window_quote_id},'-created_date',1);else if(!one)sourceQuotes=await all(api.QuoteRequests);}catch{}
    if(one)return response(jobContactsView({directory,job:directory.jobs.find(j=>j.id===rawJob.id),rawJob,links,conversations,messages,seeds:CONTACT_LINK_SEEDS,notes,events,sourceQuote:sourceQuotes[0]||null}));
    return response(jobContactCoverage({directory,rawJobs:jobs,links,conversations,messages,seeds:CONTACT_LINK_SEEDS,notes,events,sourceQuotes}));
   }
   if(input.action==='conversation'){
    const c=(await api.MessageConversation.filter({conversation_key:String(input.conversation_key||'')},'-created_date',1))[0];if(!c)return response({error:'Conversation not found.'},404);
    const matches=matchingContacts(directory.contacts,c.participants);const builderKeys=new Set(matches.map(c=>c.builder_key).filter(Boolean));
    return response({contacts:matches,jobs:directory.jobs.filter(j=>builderKeys.has(j.builder_key)||matches.some(c=>c.job_ids.includes(j.id))),source:directory.source});
   }
   if(input.action==='job'){const dj=directory.jobs.find(j=>j.id===input.job_id);if(!dj)return response({error:'Job not found.'},404);const contacts=directory.contacts.filter(c=>c.job_ids.includes(input.job_id));return response({contacts,job:{id:dj.id,name:dj.name,builder:dj.builder,address:dj.address}});}
   if(input.action==='directory'){
    // Role and link counts per contact let the page show who is connected to what.
    const linkCount=new Map();for(const l of links)linkCount.set(l.contact_key,(linkCount.get(l.contact_key)||0)+1);
    return response({...directory,contacts:directory.contacts.map(c=>({...c,contact_role:contactRole(c),link_count:linkCount.get(c.key)||0}))});
   }
   return response({error:'Unsupported action.'},400);
  }catch(error){console.error('Contacts directory failed',error?.name||'Error');return response({error:'Contacts could not be loaded. Please retry.'},500);}
 };
}

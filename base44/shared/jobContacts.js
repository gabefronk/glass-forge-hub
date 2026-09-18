// Read-only join of Jobs, ContactJobLink and the ContactDirectorySnapshot contacts for a job, plus
// proposed links. Nothing here writes: a proposal becomes a ContactJobLink only when the owner
// confirms it through the contacts-directory `link` action.
import {norm,phoneKey,builderKey,tokens} from './contactMatching.js';

export const LINK_ROLES=['superintendent','project_manager','homeowner','site'];
const ROLE_RULES=[['superintendent',/\b(super|supers|superintendent|superintendant|supt)\b/],['project_manager',/\b(pm|project manager|construction manager|field manager|lead)\b/],['homeowner',/\b(homeowner|home owner|owner|buyer|customer|resident)\b/]];
const ROLE_WORDS=new Set(['super','supers','superintendent','superintendant','supt','site','field','area','and','for','over','the']);
const RANK={high:3,medium:2,low:1};
const ROLE_NAMES={superintendent:'superintendent',project_manager:'project manager',homeowner:'homeowner',site:'site contact'};
const words=text=>norm(text).split(' ').filter(Boolean);
const push=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
const sameBuilder=(a,b)=>Boolean(a&&b&&(a===b||a.startsWith(b+' ')||b.startsWith(a+' ')));
export const qualifierOf=c=>{const b=String(c?.builder||''),co=String(c?.company||'');return (b&&co.startsWith(b)?co.slice(b.length):co).replace(/^\s*[-–—:]\s*/,'').trim();};
// The role comes from the workbook's company label ("Holmes Homes - Daybreak Super"), never from free-text notes.
export function contactRole(c){const q=norm(qualifierOf(c));for(const [role,re] of ROLE_RULES)if(re.test(q))return role;return q?'site':'builder';}
const publicContact=c=>({key:c.key,name:c.name,company:c.company||'',builder:c.builder||'',phone:c.phone||'',phone_key:c.phone_key||'',email:c.email||'',email_key:c.email_key||''});
// One adjacent swap ("Dvais" for "Davis") is the only fuzziness allowed; other variants must be listed.
function transposed(a,b){if(a.length!==b.length||a.length<4)return false;const i=[...a].findIndex((ch,k)=>ch!==b[k]);return i>=0&&i<a.length-1&&a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2);}
export function nameMatchesSeed(name,seed){const variants=[seed.name,...(seed.name_variants||[])].map(norm).filter(Boolean);return words(name).some(w=>variants.some(v=>w===v||transposed(w,v)));}

export function indexDirectory(directory,links=[]){
 const byJob=new Map(),byBuilder=new Map(),byPhone=new Map(),byEmail=new Map(),linkRole=new Map();
 for(const c of directory.contacts){for(const id of c.job_ids||[])push(byJob,id,c);push(byBuilder,c.builder_key||'',c);if(c.phone_key)push(byPhone,c.phone_key,c);if(c.email_key)push(byEmail,c.email_key,c);}
 for(const l of links)if(l.role&&LINK_ROLES.includes(l.role))linkRole.set(l.contact_key+'|'+l.job_id,l.role);
 return {byJob,byBuilder,byPhone,byEmail,linkRole};
}
export function jobFacts(job,raw){
 const labels=[job.name||raw?.canonical_name||'',...(raw?.aliases||[]),...(job.groups||[]).map(g=>g.subdivision+' '+g.lot)];
 const address=job.address||raw?.address||'';
 return {id:job.id,name:labels[0],address,builder:job.builder||raw?.builder||'',builder_keys:[...new Set([job.builder_key,builderKey(raw?.builder),...labels.map(builderKey)].filter(Boolean))],label_words:new Set(labels.flatMap(tokens)),address_words:words(address)};
}
const hasBuilder=(facts,key)=>facts.builder_keys.some(k=>sameBuilder(k,key));
// A seed applies to a job when the job name and address both fit it, or when the builder
// matches and either one fits. Returns how it matched, or '' when it does not apply.
export function seedJobMatch(seed,facts){
 const byName=(seed.job?.name_tokens||[]).some(set=>set.length>0&&set.every(t=>facts.label_words.has(norm(t))));
 const a=seed.job?.address,byAddress=Boolean(a&&facts.address_words.includes(norm(a.street))&&facts.address_words.some(w=>/^\d+$/.test(w)&&+w>=a.from&&+w<=a.to));
 if(byName&&byAddress)return 'name and address';
 if(!hasBuilder(facts,builderKey(seed.builder)))return '';
 return byName?'name':byAddress?'address':'';
}
const seedInfo=seed=>({id:seed.id,name:seed.name,phone:seed.phone||'',role:seed.role,label:seed.label||'',note:seed.note||'',name_verified:Boolean(seed.name_verified)});

export function jobContactsView({directory,job,rawJob=null,links=[],conversations=[],messages='available',seeds=[],index=indexDirectory(directory,links)}){
 const facts=jobFacts(job,rawJob);
 const linked=(index.byJob.get(job.id)||[]).map(c=>({...publicContact(c),role:index.linkRole.get(c.key+'|'+job.id)||contactRole(c),link:(c.manual_job_ids||[]).includes(job.id)?'saved':'workbook'}));
 const linkedByKey=new Map(linked.map(c=>[c.key,c])),proposals=new Map(),open=[],unknown=new Map(),seedIds=[];
 // Already-linked contacts are proposed again only to record them as this job's superintendent.
 const propose=(c,{role,confidence,reason,source})=>{
  const current=linkedByKey.get(c.key);
  if(current&&(role!=='superintendent'||current.role==='superintendent'))return;
  const s=proposals.get(c.key)||{id:'contact:'+c.key,contact:publicContact(c),role:current?.role||contactRole(c),confidence,reasons:[],sources:[],already_linked:Boolean(current)};
  if(role==='superintendent')s.role=role;
  if(RANK[confidence]>RANK[s.confidence])s.confidence=confidence;
  if(!s.reasons.includes(reason))s.reasons.push(reason);
  if(!s.sources.includes(source))s.sources.push(source);
  proposals.set(c.key,s);
 };
 const builderContacts=[...index.byBuilder].filter(([key])=>key&&hasBuilder(facts,key)).flatMap(([,list])=>list);
 for(const seed of seeds){
  const how=seedJobMatch(seed,facts);if(!how)continue;
  seedIds.push(seed.id);
  const about=`Owner note: ${seed.name} is the ${ROLE_NAMES[seed.role]||'contact'} for ${seed.label||'this job'} (matches this job's ${how}).`;
  const byPhone=seed.phone?index.byPhone.get(phoneKey(seed.phone))||[]:[];
  if(byPhone.length){for(const c of byPhone)propose(c,{role:seed.role,confidence:seed.name_verified?'high':'medium',reason:about+' Phone '+seed.phone+' matches this contact'+(nameMatchesSeed(c.name,seed)?'.':`, but the directory name is "${c.name}".`),source:'owner_note'});continue;}
  const named=builderContacts.filter(c=>nameMatchesSeed(c.name,seed));
  if(named.some(c=>linkedByKey.get(c.key)?.role===seed.role))continue;
  const reasons=[about];
  if(seed.phone)reasons.push(`Phone ${seed.phone} is not in the contacts directory.`);
  if(!seed.name_verified)reasons.push('The name spelling is unconfirmed. Check it before linking.');
  open.push({id:'seed:'+seed.id,seed:seedInfo(seed),role:seed.role,confidence:named.length?'medium':'low',reasons,sources:['owner_note'],candidates:named.map(c=>({...publicContact(c),already_linked:linkedByKey.has(c.key)})),needs:named.length?'choose_contact':'add_contact'});
 }
 for(const convo of conversations){
  if(convo.job_id!==job.id)continue;
  const title=String(convo.title||'').trim()||'a message thread';
  for(const p of convo.participants||[]){
   const phone=phoneKey(p),email=String(p||'').includes('@')?String(p).trim().toLowerCase():'';
   const matches=[...(phone?index.byPhone.get(phone)||[]:[]),...(email?index.byEmail.get(email)||[]:[])];
   if(matches.length){for(const c of matches)propose(c,{role:contactRole(c),confidence:'medium',reason:`In the message thread "${title}", which is linked to this job.`,source:'messages'});continue;}
   const id=phone||email;if(!id)continue;
   const u=unknown.get(id)||{id:'participant:'+id,participant:{phone,email},role:'',confidence:'low',reasons:[],sources:['messages'],candidates:[],needs:'add_contact'};
   const reason=`In the message thread "${title}", which is linked to this job. This number or email is not in the contacts directory.`;
   if(!u.reasons.includes(reason))u.reasons.push(reason);
   unknown.set(id,u);
  }
 }
 for(const c of builderContacts){
  const role=contactRole(c),qualifier=qualifierOf(c);
  if(!c.job_specific&&role==='superintendent'){
   const area=tokens(qualifier).filter(w=>!ROLE_WORDS.has(w));
   if(area.length&&area.every(w=>facts.label_words.has(w)))propose(c,{role,confidence:'medium',reason:`Builder superintendent listed for "${qualifier}", which matches this job's name.`,source:'directory'});
  }else if(c.job_specific&&c.candidate_count>1){
   const qt=tokens(qualifier);
   if(qt.length&&qt.every(w=>facts.label_words.has(w)))propose(c,{role,confidence:'low',reason:`The workbook label "${c.company}" fits ${c.candidate_count} jobs, including this one.`,source:'directory'});
  }
 }
 const title=s=>s.contact?.name||s.seed?.name||s.participant?.phone||s.participant?.email||'';
 const suggestions=[...proposals.values(),...open,...unknown.values()].sort((a,b)=>RANK[b.confidence]-RANK[a.confidence]||Number(b.role==='superintendent')-Number(a.role==='superintendent')||title(a).localeCompare(title(b)));
 const superintendents=linked.filter(c=>c.role==='superintendent').length;
 return {job:{id:job.id,name:facts.name,builder:facts.builder,address:facts.address},source:directory.source||null,directory:Boolean(directory.source),messages,linked,suggestions,seed_ids:seedIds,status:{linked:linked.length,superintendents,missing_contact:!linked.length,missing_superintendent:!superintendents,suggestions:suggestions.length}};
}

// Every Glass Forge job (workbook-only references excluded): link coverage, missing counts and proposals.
export function jobContactCoverage({directory,rawJobs=[],links=[],conversations=[],messages='available',seeds=[]}){
 const index=indexDirectory(directory,links),raw=new Map(rawJobs.map(j=>[j.id,j])),byJob=new Map(),matchedSeeds=new Set();
 for(const c of conversations)if(c.job_id)push(byJob,c.job_id,c);
 const rows=directory.jobs.filter(j=>!j.is_workbook).map(job=>{
  const v=jobContactsView({directory,job,rawJob:raw.get(job.id),links,conversations:byJob.get(job.id)||[],messages,seeds,index});
  for(const id of v.seed_ids)matchedSeeds.add(id);
  return {...v.job,status:v.status,superintendents:v.linked.filter(c=>c.role==='superintendent').map(c=>c.name),suggestions:v.suggestions};
 });
 const best=r=>Math.max(0,...r.suggestions.map(s=>RANK[s.confidence]));
 const count=test=>rows.filter(test).length;
 return {source:directory.source||null,directory:Boolean(directory.source),messages,
  summary:{jobs:rows.length,with_contacts:count(r=>!r.status.missing_contact),missing_contacts:count(r=>r.status.missing_contact),with_superintendent:count(r=>!r.status.missing_superintendent),missing_superintendent:count(r=>r.status.missing_superintendent),jobs_with_suggestions:count(r=>r.suggestions.length),suggestions:rows.reduce((n,r)=>n+r.suggestions.length,0)},
  suggested:rows.filter(r=>r.suggestions.length).sort((a,b)=>best(b)-best(a)||a.name.localeCompare(b.name)),
  missing:rows.filter(r=>r.status.missing_contact).map(r=>({id:r.id,name:r.name,builder:r.builder,suggestions:r.suggestions.length})).sort((a,b)=>a.name.localeCompare(b.name)),
  unmatched_seeds:seeds.filter(s=>!matchedSeeds.has(s.id)).map(seedInfo)};
}

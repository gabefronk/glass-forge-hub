// Read-only join of Jobs, ContactJobLink and the ContactDirectorySnapshot contacts for a job, plus
// proposed links. Nothing here writes: a proposal becomes a ContactJobLink only when the owner
// confirms it through the contacts-directory `link` action.
import {norm,phoneKey,builderKey,tokens} from './contactMatching.js';

export const LINK_ROLES=['superintendent','project_manager','homeowner','site','builder','customer'];
const ROLE_RULES=[{role:'superintendent',re:/\b(super|supers|superintendent|superintendant|supt)\b/},{role:'project_manager',re:/\b(pm|project manager|construction manager|field manager|lead)\b/},{role:'homeowner',re:/\b(homeowner|home owner|owner|buyer|customer|resident)\b/}];
const ROLE_WORDS=new Set(['super','supers','superintendent','superintendant','supt','site','field','area','and','for','over','the']);
const RANK={high:3,medium:2,low:1};
const ROLE_PRIORITY={builder:0,site:1,project_manager:1,homeowner:2,superintendent:3};
const ROLE_NAMES={superintendent:'superintendent',project_manager:'project manager',homeowner:'homeowner',site:'site contact'};
const COMMON_SURNAMES=new Set(['home','homes','house','customer','cash','will','call','pickup','window','windows','glass','forge','builder','builders','construction','company','residence','resident','owner','job','lot','unit']);
const words=text=>norm(text).split(' ').filter(Boolean);
const push=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
const sameBuilder=(a,b)=>Boolean(a&&b&&(a===b||a.startsWith(b+' ')||b.startsWith(a+' ')));
export const qualifierOf=c=>{const b=String(c?.builder||''),co=String(c?.company||'');return (b&&co.startsWith(b)?co.slice(b.length):co).replace(/^\s*[-–—:]\s*/,'').trim();};
// The role comes from the workbook's company label ("Holmes Homes - Daybreak Super"), never from free-text notes.
export function contactRole(c){const q=norm(qualifierOf(c));for(const {role,re} of ROLE_RULES)if(re.test(q))return role;return q?'site':'builder';}
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
 return {id:job.id,name:labels[0],labels,address,builder:job.builder||raw?.builder||'',builder_keys:[...new Set([job.builder_key,builderKey(raw?.builder),...labels.map(builderKey)].filter(Boolean))],label_words:new Set(labels.flatMap(tokens)),address_words:words(address)};
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

const emailKeys=text=>[...new Set(String(text||'').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[])];
const phoneKeys=text=>[...new Set((String(text||'').match(/(?:\+?1[\s.()-]*)?(?:\d[\s.()-]*){10}/g)||[]).map(phoneKey).filter(Boolean))];
const evidenceText=value=>{
 const out=[];
 const visit=(v,key='',depth=0)=>{if(depth>8||v==null)return;if(typeof v==='string'||typeof v==='number'){if(/(?:phone|mobile|cell|email|customer|contact)/i.test(key))out.push(String(v));return;}if(Array.isArray(v)){for(const x of v)visit(x,key,depth+1);return;}if(typeof v==='object')for(const [k,x]of Object.entries(v))visit(x,k,depth+1);};
 visit(value);return out.join('\n');
};
const keyedValues=(value,pattern)=>{const out=[];const visit=(v,key='',depth=0)=>{if(depth>8||v==null)return;if(typeof v==='string'){if(pattern.test(key)&&norm(v))out.push(v);return;}if(Array.isArray(v)){for(const x of v)visit(x,key,depth+1);return;}if(typeof v==='object')for(const [k,x]of Object.entries(v))visit(x,k,depth+1);};visit(value);return out;};
const addressKey=value=>norm(value).replace(/\b(street|st)\b/g,'st').replace(/\b(road|rd)\b/g,'rd').replace(/\b(avenue|ave)\b/g,'ave').replace(/\b(drive|dr)\b/g,'dr').replace(/\b(lane|ln)\b/g,'ln').replace(/\b(court|ct)\b/g,'ct').replace(/\bboulevard\b/g,'blvd');
const contactAddress=c=>c.address||c.street_address||c.mailing_address||c.home_address||'';
const nameParts=name=>words(name).filter(w=>w.length>0);
const weakLimit=suggestions=>{let lows=0;return suggestions.filter(s=>s.confidence!=='low'||lows++<5);};

export function jobContactsView({directory,job,rawJob=null,links=[],conversations=[],messages='available',seeds=[],notes=[],events=[],sourceQuote=null,index=indexDirectory(directory,links)}){
 const facts=jobFacts(job,rawJob);
 const linked=(index.byJob.get(job.id)||[]).map(c=>({...publicContact(c),role:index.linkRole.get(c.key+'|'+job.id)||contactRole(c),link:(c.manual_job_ids||[]).includes(job.id)?'saved':'workbook'}));
 const linkedByKey=new Map(linked.map(c=>[c.key,c])),proposals=new Map(),open=[],unknown=new Map(),seedIds=[];
 // Already-linked contacts are proposed again only to record them as this job's superintendent.
 const propose=(c,{role,confidence,reason,source})=>{
  const current=linkedByKey.get(c.key);
  if(current&&(role!=='superintendent'||current.role==='superintendent'))return;
  const s=proposals.get(c.key)||{id:'contact:'+c.key,contact:publicContact(c),role:current?.role||role||contactRole(c),confidence,reasons:[],sources:[],already_linked:Boolean(current)};
  if(role&&(ROLE_PRIORITY[role]||0)>(ROLE_PRIORITY[s.role]||0))s.role=role;
  if(RANK[confidence]>RANK[s.confidence])s.confidence=confidence;
  if(!s.reasons.includes(reason))s.reasons.push(reason);
  if(!s.sources.includes(source))s.sources.push(source);
  proposals.set(c.key,s);
 };
 const builderContacts=[...index.byBuilder].filter(([key])=>key&&hasBuilder(facts,key)).flatMap(([,list])=>list);
 const customerNameValues=[rawJob?.customer_name,...keyedValues(rawJob?.accepted_quote_snapshot,/^(?:customer|contact)_?name$/i),...keyedValues(sourceQuote,/^(?:customer|contact)_?name$/i)].filter(Boolean);
 const customerNames=customerNameValues.map(norm);
 const builderWords=new Set([...words(facts.builder),...(directory.builders||[]).flatMap(words)]);
 const labelsNorm=facts.labels.map(norm),jobHasBuilder=Boolean(facts.builder);
 for(const c of directory.contacts){
  const parts=nameParts(c.name),first=parts[0]||'',last=parts.at(-1)||'';
  for(const customer of customerNames){
   if(customer===norm(c.name))propose(c,{role:'homeowner',confidence:'high',reason:`Customer name "${customerNameValues[customerNames.indexOf(customer)]||c.name}" exactly matches this directory contact.`,source:'customer_name'});
   else if(last.length>=3&&(customer===last||(first&&customer===first[0]+' '+last)))propose(c,{role:'homeowner',confidence:'medium',reason:`Customer name "${customerNameValues[customerNames.indexOf(customer)]||customer}" matches ${c.name}'s surname or first initial.`,source:'customer_name'});
  }
  const staff=!['homeowner','site'].includes(contactRole(c))&&!/\bcash customer\b|\bhome ?owner\b/i.test(c.company||'')&&Boolean(c.builder);
  if(last.length>=3&&!COMMON_SURNAMES.has(last)&&!builderWords.has(last)&&(!staff||!jobHasBuilder)){
   const full=parts.length>=2&&labelsNorm.some(label=>(' '+label+' ').includes(' '+parts.join(' ')+' '));
   const surname=facts.label_words.has(last);
   if(full||surname)propose(c,{role:'homeowner',confidence:full?'high':'medium',reason:full?`Full contact name "${c.name}" appears in the job name or an alias.`:`Surname "${last}" appears in the job name or an alias.`,source:'job_name'});
  }
  const ca=contactAddress(c);
  if(ca&&facts.address&&addressKey(ca)===addressKey(facts.address))propose(c,{role:'homeowner',confidence:'medium',reason:`Directory address "${ca}" matches the job address.`,source:'address'});
 }
 const evidence=[
  {source:'job',label:'the job record',text:evidenceText(rawJob)},
  {source:'accepted_quote',label:'the accepted quote',text:evidenceText(rawJob?.accepted_quote_snapshot)},
  {source:'source_quote',label:'the source quote request',text:evidenceText(sourceQuote)},
  {source:'job_notes',label:'a job note',text:notes.map(n=>n.body||'').join('\n')},
  {source:'calendar',label:'a linked calendar event',text:events.map(e=>[e.description,e.scope_notes,e.location,e.source_location,e.address].filter(Boolean).join('\n')).join('\n')}
 ];
 for(const item of evidence){
  const phones=new Set(phoneKeys(item.text)),emails=new Set(emailKeys(item.text));
  if(!phones.size&&!emails.size)continue;
  for(const c of directory.contacts)if((c.phone_key&&phones.has(c.phone_key))||(c.email_key&&emails.has(c.email_key)))propose(c,{role:'homeowner',confidence:'high',reason:`Phone or email matches this contact in ${item.label}.`,source:item.source});
 }
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
 const suggestions=weakLimit([...proposals.values(),...open,...unknown.values()].sort((a,b)=>RANK[b.confidence]-RANK[a.confidence]||Number(b.role==='superintendent')-Number(a.role==='superintendent')||title(a).localeCompare(title(b))));
 const superintendents=linked.filter(c=>c.role==='superintendent').length;
 return {job:{id:job.id,name:facts.name,builder:facts.builder,address:facts.address},source:directory.source||null,directory:Boolean(directory.source),messages,linked,suggestions,seed_ids:seedIds,status:{linked:linked.length,superintendents,missing_contact:!linked.length,missing_superintendent:!superintendents,suggestions:suggestions.length}};
}

// Every Glass Forge job (workbook-only references excluded): link coverage, missing counts and proposals.
export function jobContactCoverage({directory,rawJobs=[],links=[],conversations=[],messages='available',seeds=[],notes=[],events=[],sourceQuotes=[]}){
 const index=indexDirectory(directory,links),raw=new Map(rawJobs.map(j=>[j.id,j])),byJob=new Map(),matchedSeeds=new Set();
 for(const c of conversations)if(c.job_id)push(byJob,c.job_id,c);
 const notesByJob=new Map(),eventsByJob=new Map(),quotesById=new Map(sourceQuotes.map(q=>[q.id,q]));
 for(const n of notes)if(n.job_id)push(notesByJob,n.job_id,n);for(const e of events)if(e.job_id)push(eventsByJob,e.job_id,e);
 const rows=directory.jobs.filter(j=>!j.is_workbook).map(job=>{
  const r=raw.get(job.id);const v=jobContactsView({directory,job,rawJob:r,links,conversations:byJob.get(job.id)||[],messages,seeds,notes:notesByJob.get(job.id)||[],events:eventsByJob.get(job.id)||[],sourceQuote:quotesById.get(r?.source_window_quote_id)||null,index});
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

// Bulk confirmation is deliberately conservative: exactly one high-confidence directory
// contact may exist for a role on a job. The caller still writes every returned link via `link`.
export function highConfidenceSingleCandidateLinks(coverage){
 const links=[];
 for(const job of coverage?.suggested||[]){
  const byRole=new Map();
  for(const s of job.suggestions||[])if(s.confidence==='high'&&s.contact&&!s.already_linked)push(byRole,s.role||contactRole(s.contact),s);
  for(const [role,list]of byRole){const keys=[...new Set(list.map(s=>s.contact.key))];if(keys.length===1)links.push({job_id:job.id,job_name:job.name,contact_key:keys[0],contact_name:list[0].contact.name,role,reasons:list[0].reasons});}
 }
 return links;
}

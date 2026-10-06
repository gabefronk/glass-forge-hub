// Owner-reviewed contact cleanup: duplicate merges, missing builders and missing roles.
// planContactCleanup() only proposes; nothing is written until the owner applies an item
// through the owner-only `cleanup_apply` action, which re-plans on the server first.
// The workbook snapshot is never edited: fixes to a snapshot contact are stored as a
// HubContacts "override" row with the same key, and a merged-away contact is kept with
// status "merged" (never deleted) so its links and history stay traceable.
import {norm,phoneKey,contactPhoneKeys,contactEmailKeys,builderCore} from './contactMatching.js';
import {contactRole,qualifierOf,sprContacts,LINK_ROLES} from './jobContacts.js';

const OVERLAY_TEXT=['builder','company','role','status','merged_into','note'];
const OVERLAY_LISTS=['merged_keys','aliases','phones','emails'];
export const CONTACT_ROLES=['superintendent','project_manager','builder','site','homeowner','customer'];

// Snapshot contacts with their override rows applied, plus hub-only contacts.
export function applyContactOverlay(stored=[],hubRows=[]){
 const storedKeys=new Set(stored.map(c=>c.key)),byKey=new Map(hubRows.map(r=>[r.key,r]));
 const patched=stored.map(c=>{
  const o=byKey.get(c.key);if(!o)return c;
  const out={...c,override_id:o.id};
  for(const f of OVERLAY_TEXT)if(o[f])out[f]=o[f];
  for(const f of OVERLAY_LISTS)if(Array.isArray(o[f])&&o[f].length)out[f]=o[f];
  if(o.builder&&o.builder!==c.builder)out.source_builder=c.builder;
  return out;
 });
 // Override rows whose snapshot contact is gone (a re-import changed it) have nothing to patch.
 const own=hubRows.filter(r=>!storedKeys.has(r.key)&&r.source!=='override').map(c=>({...c,hub_id:c.id,row:0}));
 return [...patched,...own];
}
// Follows merged_into so an old key (a saved link, a bookmark) reaches the surviving contact.
export function resolveContact(contacts,key){
 const byKey=new Map(contacts.map(c=>[c.key,c]));let c=byKey.get(key);
 for(let i=0;c&&c.status==='merged'&&c.merged_into&&i<8;i++)c=byKey.get(c.merged_into)||c;
 return c||null;
}
export const activeContacts=contacts=>contacts.filter(c=>c.status!=='merged');

const FREE_MAIL=new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','aol.com','msn.com','live.com','me.com','comcast.net','msn.net','protonmail.com']);
const nameWords=name=>norm(name).split(' ').filter(Boolean);
// "Matt" and "Matt Klingler" (or two identical names) can be one person; "Amiee Kelly" and "Kelly Staheli" cannot.
export function namesCompatible(a,b){
 const x=nameWords(a),y=nameWords(b);if(!x.length||!y.length)return false;
 if(x.join(' ')===y.join(' '))return true;
 const [short,long]=x.length<=y.length?[x,y]:[y,x];
 return short.every((w,i)=>w===long[i]);
}
const sameBuilder=(a,b)=>{const x=a.builder_core??builderCore(a.builder),y=b.builder_core??builderCore(b.builder);return !x||!y||x===y;};
const card=c=>({key:c.key,name:c.name,company:c.company||'',builder:c.builder_name||c.builder||'',phone:c.phone||'',email:c.email||'',row:c.row||0});
// The most complete record survives: full name, phone, email, job links, then the workbook row.
function survivorOf(group,linkCount){
 const score=c=>(nameWords(c.name).length>1?8:0)+(c.phone_key?4:0)+(c.email_key?4:0)+(c.builder?2:0)+Math.min(linkCount.get(c.key)||0,5)+(c.row>0?1:0);
 return [...group].sort((a,b)=>score(b)-score(a)||(a.row||1e9)-(b.row||1e9)||String(a.key).localeCompare(String(b.key)))[0];
}

export function planContactCleanup({contacts=[],links=[],events=[],jobs=[]}={}){
 const active=activeContacts(contacts).filter(c=>c.key);
 const linkCount=new Map();for(const l of links)linkCount.set(l.contact_key,(linkCount.get(l.contact_key)||0)+1);
 const items=[];
 // ---- duplicates: same phone, same email, or the same full name at the same builder
 const parent=new Map(active.map(c=>[c.key,c.key])),why=new Map();
 const find=k=>{while(parent.get(k)!==k)k=parent.get(k);return k;};
 const join=(a,b,reason)=>{const ra=find(a.key),rb=find(b.key);if(ra!==rb)parent.set(rb,ra);const k=[a.key,b.key].sort().join('|');why.set(k,[...new Set([...(why.get(k)||[]),reason])]);};
 const bucket=new Map();const add=(k,c)=>{if(!bucket.has(k))bucket.set(k,[]);bucket.get(k).push(c);};
 for(const c of active){for(const p of contactPhoneKeys(c))add('p:'+p,c);for(const e of contactEmailKeys(c))add('e:'+e,c);const n=nameWords(c.name);if(n.length>=2)add('n:'+n.join(' ')+'|'+(c.builder_core??builderCore(c.builder)),c);}
 for(const [k,list] of bucket){if(list.length<2)continue;const reason=k[0]==='p'?'Same phone number':k[0]==='e'?'Same email address':'Same full name at the same builder';for(let i=1;i<list.length;i++)join(list[0],list[i],reason);}
 const groups=new Map();for(const c of active){const r=find(c.key);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(c);}
 for(const group of groups.values()){
  if(group.length<2)continue;
  const survivor=survivorOf(group,linkCount),others=group.filter(c=>c.key!==survivor.key);
  const reasons=[...new Set([...why.values()].flat())].filter(r=>[...why.keys()].some(k=>k.split('|').every(x=>group.some(c=>c.key===x))&&why.get(k).includes(r)));
  const compatible=others.every(c=>namesCompatible(c.name,survivor.name)&&sameBuilder(c,survivor));
  const phones=[...new Set(group.flatMap(c=>[c.phone,...(c.phones||[])]).filter(p=>p&&phoneKey(p)&&!contactPhoneKeys(survivor).includes(phoneKey(p))))];
  const emails=[...new Set(group.flatMap(contactEmailKeys).filter(e=>!contactEmailKeys(survivor).includes(e)))];
  const aliases=[...new Set(others.map(c=>c.name).filter(n=>norm(n)!==norm(survivor.name)))];
  const ids=group.map(c=>c.key).sort();
  items.push({id:'merge:'+ids.join('+'),type:'merge',confidence:compatible?'high':'review',survivor:card(survivor),merge:others.map(card),reasons:compatible?reasons:[...reasons,'Different names or builders: check these are the same person before merging.'],
   result:{phones,emails,aliases,links:others.reduce((n,c)=>n+(linkCount.get(c.key)||0),0)}});
 }
 const merging=new Set(items.flatMap(i=>i.merge.map(c=>c.key)));
 // ---- missing builder / company, from a company email domain or confirmed job links
 const byDomain=new Map();
 for(const c of active){if(!c.builder)continue;for(const e of contactEmailKeys(c)){const d=e.split('@')[1];if(FREE_MAIL.has(d))continue;if(!byDomain.has(d))byDomain.set(d,new Map());const m=byDomain.get(d),b=c.builder_name||c.builder;m.set(b,(m.get(b)||0)+1);}}
 const jobsById=new Map(jobs.map(j=>[j.id,j]));
 for(const c of active){
  if(c.builder||merging.has(c.key)||contactRole(c)==='homeowner'||c.role==='homeowner'||c.role==='customer')continue;
  const reasons=[];let builder='',confidence='review';
  for(const e of contactEmailKeys(c)){const m=byDomain.get(e.split('@')[1]);if(m&&m.size===1){builder=[...m.keys()][0];confidence='high';reasons.push(`Email domain @${e.split('@')[1]} is used by ${[...m.values()][0]} ${builder} contact${[...m.values()][0]===1?'':'s'}.`);break;}}
  if(!builder){
   const staff=links.filter(l=>l.contact_key===c.key&&!['homeowner','customer'].includes(l.role||'')).map(l=>jobsById.get(l.job_id)?.builder).filter(Boolean);
   const set=[...new Set(staff)];if(set.length===1){builder=set[0];reasons.push(`Linked to ${staff.length} ${builder} job${staff.length===1?'':'s'}.`);}
  }
  if(builder)items.push({id:'builder:'+c.key,type:'builder',confidence,contact:card(c),builder,company:c.review_note||!c.company?builder:c.company,reasons});
 }
 // ---- missing role: a calendar SPR line with this phone, or consistent confirmed job-link roles
 const sprPhones=new Map();
 for(const e of events)for(const s of sprContacts(e.scope_notes))sprPhones.set(s.phone_key,(sprPhones.get(s.phone_key)||0)+1);
 for(const c of active){
  if(merging.has(c.key)||c.role||qualifierOf(c)&&!c.review_note)continue;
  const spr=contactPhoneKeys(c).reduce((n,k)=>n+(sprPhones.get(k)||0),0);
  const roles=[...new Set(links.filter(l=>l.contact_key===c.key&&l.role&&LINK_ROLES.includes(l.role)).map(l=>l.role))];
  const count=links.filter(l=>l.contact_key===c.key&&l.role).length;
  if(spr)items.push({id:'role:'+c.key,type:'role',confidence:'high',contact:card(c),role:'superintendent',reasons:[`Listed as "SPR" (site super) in ${spr} calendar event${spr===1?'':'s'}.`]});
  else if(roles.length===1)items.push({id:'role:'+c.key,type:'role',confidence:count>=2?'high':'review',contact:card(c),role:roles[0],reasons:[`Confirmed as ${roles[0].replace('_',' ')} on ${count} job${count===1?'':'s'}.`]});
 }
 const count=(type,conf)=>items.filter(i=>i.type===type&&(!conf||i.confidence===conf)).length;
 return {items,summary:{contacts:active.length,merged:contacts.length-active.length,duplicate_groups:count('merge'),confident_merges:count('merge','high'),missing_builder:active.filter(c=>!c.builder&&c.role!=='homeowner'&&contactRole(c)!=='homeowner').length,builder_proposals:count('builder'),role_proposals:count('role'),confident:items.filter(i=>i.confidence==='high').length,unlinked:active.filter(c=>!(c.job_ids||[]).length&&!linkCount.get(c.key)).length}};
}

// The HubContacts writes for one planned item. `upsert(key, patch, base)` and `repoint(from, to)`
// are supplied by the handler, so this stays pure and testable.
export async function applyCleanupItem(item,contacts,{upsert,repoint}){
 const byKey=new Map(contacts.map(c=>[c.key,c]));
 if(item.type==='merge'){
  const s=byKey.get(item.survivor.key);if(!s)throw Error('Survivor not found.');
  const union=(a,b)=>[...new Set([...(a||[]),...(b||[])].filter(Boolean))];
  await upsert(s.key,{phones:union(s.phones,item.result.phones),emails:union(s.emails,item.result.emails),aliases:union(s.aliases,item.result.aliases),merged_keys:union(s.merged_keys,item.merge.map(c=>c.key))},s);
  for(const m of item.merge){const c=byKey.get(m.key);if(!c)continue;await upsert(c.key,{status:'merged',merged_into:s.key},c);await repoint(c.key,s.key);}
  return {merged:item.merge.length};
 }
 if(item.type==='builder'){const c=byKey.get(item.contact.key);if(!c)throw Error('Contact not found.');await upsert(c.key,{builder:item.builder,company:item.company},c);return {builder:item.builder};}
 if(item.type==='role'){const c=byKey.get(item.contact.key);if(!c)throw Error('Contact not found.');if(!CONTACT_ROLES.includes(item.role))throw Error('Unsupported role.');await upsert(c.key,{role:item.role},c);return {role:item.role};}
 throw Error('Unsupported cleanup item.');
}

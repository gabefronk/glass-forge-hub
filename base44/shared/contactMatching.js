// Source workbook values remain intact. Matching creates associations, never edits jobs.
import {normalizeCustomer} from './jobIdentity.js';
export const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export const phoneKey = value => { const d=String(value||'').replace(/\D/g,''); return d.length===10?'+1'+d:d.length===11&&d[0]==='1'?'+'+d:''; };
export const builderKey = value => {
 const n=norm(value).replace(/\bhomes\b/g,'home');
 return ({'edge home':'edge','lgi home':'lgi','primo builders':'primo','lighthouse home':'lighthouse'})[n]||n;
};
// Builder identity shared by contacts and Jobs.builder. Starts from jobIdentity's
// normalizeCustomer (drops Inc/LLC, "Homes"→"home"), fixes known typos, then drops
// trailing generic words so "Edge", "Edge Homes" and "Edge Construction" agree.
// A job builder such as "Holmes 328 Daybreak" belongs to the known builder whose
// core it starts with (see builderCoreMatch). Read-time only; nothing is rewritten.
const CORE_TOKENS={homles:'holmes',holme:'holmes',lanscope:'landscope',anderson:'andersen',mountian:'mountain',devopment:'development',customers:'customer',estates:'estate'};
const CORE_GENERIC=new Set(['home','builder','construction','const','constructions','custom','group','estate','development','dev','mgt','management','contracting','contractor','contractors','property','properties','services','service','of','utah']);
const CORE_PHRASES={'david weekley':'weekley','valor holmes':'valor'};
export const builderCore = value => {
 const t=normalizeCustomer(value).split(' ').filter(Boolean).map(w=>Object.hasOwn(CORE_TOKENS,w)?CORE_TOKENS[w]:w);
 while(t.length>1&&CORE_GENERIC.has(t.at(-1)))t.pop();
 const core=t.join(' ');return Object.hasOwn(CORE_PHRASES,core)?CORE_PHRASES[core]:core;
};
export const builderCoreMatch = (value, knownCore) => Boolean(value&&knownCore&&(value===knownCore||value.startsWith(knownCore+' ')));
// Cash / walk-in "builders" group unrelated one-off customers, so they never share contacts.
export const sharedBuilderCore = core => Boolean(core)&&!/^(cash|ya)\b/.test(core);
// Every phone / email a contact is known by (primary first), including merged extras.
export const contactPhoneKeys = c => [...new Set([c?.phone_key,...(c?.phones||[]).map(phoneKey)].filter(Boolean))];
export const contactEmailKeys = c => [...new Set([c?.email_key,...(c?.emails||[]).map(e=>String(e||'').trim().toLowerCase())].filter(e=>e&&e.includes('@')))];
// A label spelled with a known typo ("Holme Homes", "Valor Holmes") never becomes the canonical name.
const typo=name=>{const w=norm(name).split(' ');return w.some(x=>Object.hasOwn(CORE_TOKENS,x)&&!['customers','estates'].includes(x))||Object.keys(CORE_PHRASES).some(p=>p!=='david weekley'&&norm(name).replace(/\bhomes?\b/g,'').trim()===p);};
// Groups builder labels by core. The canonical label is the one used by the most contacts
// (`labels`), then by the most workbook job rows (`extra`), then the longest; typos never win.
export function builderCatalog(labels,extra=[]){
 const byCore=new Map();
 for(const [list,weight] of [[labels,1000],[extra,1]])for(const label of list){const name=String(label||'').trim();if(!name)continue;const core=builderCore(name);if(!core)continue;const g=byCore.get(core)||new Map();g.set(name,(g.get(name)||0)+weight);byCore.set(core,g);}
 const entries=[...byCore].map(([core,names])=>{const name=[...names].sort((a,b)=>Number(typo(a[0]))-Number(typo(b[0]))||b[1]-a[1]||b[0].length-a[0].length||a[0].localeCompare(b[0]))[0][0];return {core,name,key:builderKey(name),variants:[...names.keys()]};});
 const byLength=[...entries].sort((a,b)=>b.core.length-a.core.length);
 const find=value=>{const core=builderCore(value);return core?byLength.find(e=>builderCoreMatch(core,e.core))||null:null;};
 return {entries,find};
}
const orderKey = value => String(value||'').trim().replace(/-\d{2}$/, '');
export const tokens = text => norm(text).split(' ').filter(t=>t&&!['lot','bldg','building','unit','res','residence'].includes(t));
export function buildDirectory(data, rawJobs, manualLinks=[]) {
 // Contacts' labels decide the canonical builder name; workbook job rows only add builders.
 const catalog=builderCatalog(data.contacts.map(c=>c.builder),data.job_references.map(r=>r.builder));
 const canonical=value=>catalog.find(value)?.name||String(value||'');
 const builderNames=catalog.entries.map(e=>e.name).sort((a,b)=>a.localeCompare(b));
 const index=new Map();
 for(const r of data.job_references) for(const [kind,value] of [['oe',r.oe],['po',r.po]]) if(value){const k=kind+':'+orderKey(value);if(!index.has(k))index.set(k,[]);index.get(k).push(r);}
 const jobs=rawJobs.map(j=>{
  const nameMatch=[j.canonical_name,...(j.aliases||[])].map(n=>catalog.find(n)).find(Boolean);
  const recognized=catalog.find(j.builder)||catalog.find(j.customer_name);
  const expected=nameMatch?.key||recognized?.key||'';
  const refs=new Map();
  for(const [kind,values] of [['oe',j.oe_numbers||[]],['po',j.po_numbers||[]]]) for(const value of values) for(const r of index.get(kind+':'+orderKey(value))||[]) {
   if(expected && builderKey(canonical(r.builder))!==expected)continue;
   refs.set(r.row,r);
  }
  const refKeys=new Set([...refs.values()].map(r=>builderKey(canonical(r.builder))));
  // Conflicting reference builders cannot establish an association.
  const accepted=refKeys.size===1?[...refs.values()]:[];
  const builder=(accepted[0]?canonical(accepted[0].builder):'')||nameMatch?.name||recognized?.name||'';
  const groups=[...new Map(accepted.map(r=>[r.subdivision+'|'+r.lot,{subdivision:r.subdivision,lot:r.lot,source_rows:[...refs.values()].filter(x=>x.subdivision===r.subdivision&&x.lot===r.lot).map(x=>x.row)}])).values()];
  return {id:j.id,name:j.canonical_name,address:j.address||'',builder,builder_key:builderKey(builder),groups,po_numbers:j.po_numbers||[],oe_numbers:j.oe_numbers||[]};
 });
 const groupKey=(builder,subdivision,lot)=>builderKey(canonical(builder))+'~'+norm(subdivision)+'~'+norm(lot);
 const represented=new Set(jobs.flatMap(j=>j.groups.map(g=>groupKey(j.builder,g.subdivision,g.lot))));
 const workbookGroups=new Map();
 for(const r of data.job_references){const key=groupKey(r.builder,r.subdivision,r.lot);if(represented.has(key))continue;if(!workbookGroups.has(key))workbookGroups.set(key,[]);workbookGroups.get(key).push(r);}
 for(const [key,rows]of workbookGroups){const r=rows[0],b=canonical(r.builder);jobs.push({id:'workbook:'+key,name:[b,r.subdivision,r.lot?'Lot '+r.lot:''].filter(Boolean).join(' · '),address:'',builder:b,builder_key:builderKey(b),is_workbook:true,groups:[{subdivision:r.subdivision,lot:r.lot,source_rows:rows.map(x=>x.row)}],po_numbers:[...new Set(rows.map(x=>x.po).filter(Boolean))],oe_numbers:[...new Set(rows.map(x=>x.oe).filter(Boolean))]});}
 const jobIds=new Set(jobs.map(j=>j.id));
 const contacts=data.contacts.map(c=>{
  const builderName=canonical(c.builder),key=builderKey(builderName),qualifier=c.company.slice(c.builder.length).replace(/^\s*-\s*/,''),qt=tokens(qualifier);
  const specific=!c.review_note&&qt.length>=2&&(/\d/.test(qualifier)||/\bres(?:idence)?\b/i.test(qualifier));
  const candidates=specific?jobs.filter(j=>j.builder_key===key&&[j.name,...j.groups.map(g=>g.subdivision+' '+g.lot)].some(label=>qt.every(t=>tokens(label).includes(t)))):[];
  const saved=manualLinks.filter(l=>l.contact_key===c.key&&jobIds.has(l.job_id));
  return {...c,builder_name:builderName,builder_key:key,builder_core:builderCore(builderName),phone_keys:contactPhoneKeys(c),email_keys:contactEmailKeys(c),job_specific:specific,auto_job_ids:candidates.length===1?[candidates[0].id]:[],candidate_count:candidates.length,manual_job_ids:saved.map(l=>l.job_id),job_ids:[...new Set([...saved.map(l=>l.job_id),...(candidates.length===1?[candidates[0].id]:[])])]};
 });
 return {source:data.source,contacts,jobs,builders:builderNames,builder_variants:catalog.entries.filter(e=>e.variants.length>1).map(e=>({name:e.name,variants:e.variants})),summary:{contacts:contacts.length,phones:contacts.filter(c=>c.phone_key).length,emails:contacts.filter(c=>c.email_key).length,automatic_job_links:contacts.filter(c=>c.auto_job_ids.length).length,manual_job_links:manualLinks.length,review_contacts:contacts.filter(c=>c.review_note).length,workbook_jobs:workbookGroups.size,job_reference_rows:data.job_references.length,jobs_with_builder:jobs.filter(j=>j.builder).length}};
}
export function matchingContacts(contacts, participants) {
 const phones=new Set((participants||[]).map(phoneKey).filter(Boolean));
 const emails=new Set((participants||[]).map(p=>String(p).trim().toLowerCase()).filter(p=>p.includes('@')));
 return contacts.filter(c=>contactPhoneKeys(c).some(k=>phones.has(k))||contactEmailKeys(c).some(k=>emails.has(k)));
}

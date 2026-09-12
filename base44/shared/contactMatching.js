// Source workbook values remain intact. Matching creates associations, never edits jobs.
export const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export const phoneKey = value => { const d=String(value||'').replace(/\D/g,''); return d.length===10?'+1'+d:d.length===11&&d[0]==='1'?'+'+d:''; };
export const builderKey = value => {
 const n=norm(value).replace(/\bhomes\b/g,'home');
 return ({'edge home':'edge','lgi home':'lgi','primo builders':'primo','lighthouse home':'lighthouse'})[n]||n;
};
const orderKey = value => String(value||'').trim().replace(/-\d{2}$/, '');
const starts = (text,key) => text===key||text.startsWith(key+' ');
const tokens = text => norm(text).split(' ').filter(t=>t&&!['lot','bldg','building','unit','res','residence'].includes(t));
export function buildDirectory(data, rawJobs, manualLinks=[]) {
 const builderNames=[...new Set([...data.job_references.map(r=>r.builder),...data.contacts.map(c=>c.builder)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 const aliases=builderNames.map(name=>({name,key:builderKey(name)})).sort((a,b)=>b.key.length-a.key.length);
 const index=new Map();
 for(const r of data.job_references) for(const [kind,value] of [['oe',r.oe],['po',r.po]]) if(value){const k=kind+':'+orderKey(value);if(!index.has(k))index.set(k,[]);index.get(k).push(r);}
 const jobs=rawJobs.map(j=>{
  const names=[j.canonical_name,...(j.aliases||[])].map(builderKey);
  const nameMatch=aliases.find(a=>names.some(n=>starts(n,a.key)));
  const fieldKey=builderKey(j.builder);
  const recognized=aliases.find(a=>a.key===fieldKey);
  const expected=nameMatch?.key||recognized?.key||'';
  const refs=new Map();
  for(const [kind,values] of [['oe',j.oe_numbers||[]],['po',j.po_numbers||[]]]) for(const value of values) for(const r of index.get(kind+':'+orderKey(value))||[]) {
   if(expected && builderKey(r.builder)!==expected)continue;
   refs.set(r.row,r);
  }
  const refKeys=new Set([...refs.values()].map(r=>builderKey(r.builder)));
  // Conflicting reference builders cannot establish an association.
  const accepted=refKeys.size===1?[...refs.values()]:[];
  const builder=accepted[0]?.builder||nameMatch?.name||recognized?.name||'';
  const groups=[...new Map(accepted.map(r=>[r.subdivision+'|'+r.lot,{subdivision:r.subdivision,lot:r.lot,source_rows:[...refs.values()].filter(x=>x.subdivision===r.subdivision&&x.lot===r.lot).map(x=>x.row)}])).values()];
  return {id:j.id,name:j.canonical_name,address:j.address||'',builder,builder_key:builderKey(builder),groups,po_numbers:j.po_numbers||[],oe_numbers:j.oe_numbers||[]};
 });
 const jobIds=new Set(jobs.map(j=>j.id));
 const contacts=data.contacts.map(c=>{
  const key=builderKey(c.builder),qualifier=c.company.slice(c.builder.length).replace(/^\s*-\s*/,''),qt=tokens(qualifier);
  const specific=!c.review_note&&qt.length>=2&&(/\d/.test(qualifier)||/\bres(?:idence)?\b/i.test(qualifier));
  const candidates=specific?jobs.filter(j=>j.builder_key===key&&[j.name,...j.groups.map(g=>g.subdivision+' '+g.lot)].some(label=>qt.every(t=>tokens(label).includes(t)))):[];
  const saved=manualLinks.filter(l=>l.contact_key===c.key&&jobIds.has(l.job_id));
  return {...c,builder_key:key,job_specific:specific,auto_job_ids:candidates.length===1?[candidates[0].id]:[],candidate_count:candidates.length,manual_job_ids:saved.map(l=>l.job_id),job_ids:[...new Set([...saved.map(l=>l.job_id),...(candidates.length===1?[candidates[0].id]:[])])]};
 });
 return {source:data.source,contacts,jobs,builders:builderNames,summary:{contacts:contacts.length,phones:contacts.filter(c=>c.phone_key).length,emails:contacts.filter(c=>c.email_key).length,automatic_job_links:contacts.filter(c=>c.auto_job_ids.length).length,manual_job_links:manualLinks.length,review_contacts:contacts.filter(c=>c.review_note).length,job_reference_rows:data.job_references.length,jobs_with_builder:jobs.filter(j=>j.builder).length}};
}
export function matchingContacts(contacts, participants) {
 const phones=new Set((participants||[]).map(phoneKey).filter(Boolean));
 const emails=new Set((participants||[]).map(p=>String(p).trim().toLowerCase()).filter(p=>p.includes('@')));
 return contacts.filter(c=>(c.phone_key&&phones.has(c.phone_key))||(c.email_key&&emails.has(c.email_key)));
}

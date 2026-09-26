import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {buildDirectory,builderCore,builderCatalog,sharedBuilderCore} from '../base44/shared/contactMatching.js';
import {jobContactsView,sprContacts,eventsByJob,calendarSuperAdds,contactRole} from '../base44/shared/jobContacts.js';
import {planContactCleanup,applyContactOverlay,resolveContact,namesCompatible} from '../base44/shared/contactCleanup.js';
import {homeownerPrefill,pickHomeowner} from '../base44/shared/jobHomeowner.js';
import {createContactsDirectoryHandler,canonicalJson} from '../base44/shared/contactsDirectory.js';
import {pickSuper} from '../src/lib/jobWorkspace.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const person=(k,name,company,phone='',email='')=>{const d=phone.replace(/\D/g,'');return {key:k.repeat(64),row:2,name,builder:company.split(/\s*-\s*/)[0].trim(),company,phone,phone_key:d.length===10?'+1'+d:'',email,email_key:email.toLowerCase(),note:'',review_note:''};};
const MATT=person('1','Matt','Home Sweet Home - PM','(801) 555-0172','matt@hshbuild.com');
const MATTK=person('2','Matt Klingler','Home Sweet Home - PM','801.555.0172','matt@hshbuild.com');
const AMIEE=person('3','Amiee Kelly','All Home Services - Owner','801-555-0181','office@allhome.com');
const KELLY=person('4','Kelly Staheli','All Home Services - Owner','801-555-0182','office@allhome.com');
const WPM=person('5','Wes Pm','Weekley Homes - PM','801-555-0101','wes@dwhomes.com');
const WOFFICE=person('6','Wendy Office','Weekley Homes','801-555-0102','wendy@dwhomes.com');
const HOLME=person('7','Hal Holme','Holme Homes - Warranty','801-555-0103');
const HOLMES=person('8','Hank Holmes','Holmes Homes - Super','801-555-0104');
const HOLMES2=person('9','Hugo Holmes','Holmes Homes - PM','801-555-0105');
const NOBUILDER={...person('a','Jarom','','801-555-0106','jarom@dwhomes.com'),company:'Retrieving data. Wait a few seconds',review_note:'Builder cell contains an Excel retrieval error.'};
const NOROLE=person('b','Nate Noqual','Holmes Homes','801-555-0107');
const CASH=person('c','Carl Cash','Cash Customer','801-555-0108');
const LOTGUY=person('d','Lot Guy','Weekley Homes - Oak Hollow 12','801-555-0109');
const CONTACTS=[MATT,MATTK,AMIEE,KELLY,WPM,WOFFICE,HOLME,HOLMES,HOLMES2,NOBUILDER,NOROLE,CASH,LOTGUY];
const data={version:1,source:{filename:'t.xlsm',workbook_sha256:'d'.repeat(64),captured_at:'2026-09-20T12:00:00Z',location:'Test'},contacts:CONTACTS,job_references:[{row:2,builder:'Edge',subdivision:'X',lot:'1',po:'1',oe:'2'}]};
const WJOB={id:'wj',canonical_name:'Oakwood 44',builder:'DAVID WEEKLEY',customer_name:'DAVID WEEKLEY',address:'',aliases:[],po_numbers:[],oe_numbers:[]};
const HJOB={id:'hj',canonical_name:'Holmes 328 Daybreak',builder:'Holmes 328 Daybreak',address:'',aliases:[],po_numbers:[],oe_numbers:[]};
const CJOB={id:'cj',canonical_name:'Barker pickup',builder:'CASH CUSTOMERS',customer_name:'Todd Barker',address:'',aliases:[],po_numbers:[],oe_numbers:[]};
const JOBS=[WJOB,HJOB,CJOB];

test('builder names normalize the same way for contacts and Jobs.builder',()=>{
 assert.equal(builderCore('Edge Homes'),builderCore('Edge'));
 assert.equal(builderCore('Edge Construction'),'edge');
 assert.equal(builderCore('DAVID WEEKLEY'),builderCore('Weekley Homes'));
 assert.equal(builderCore('Holme Homes'),builderCore('Holmes Homes'));
 assert.equal(builderCore('Valor Holmes'),builderCore('Valor Homes'));
 assert.equal(builderCore('Raykon Property Services'),builderCore('Raykon'));
 assert.equal(builderCore('Hillwood Homes of Utah'),'hillwood');
 assert.equal(builderCore('HOME SWEET HOMES'),builderCore('Home Sweet Home'));
 assert.notEqual(builderCore('Home Sweet Home'),builderCore('Home Designer'));
 const cat=builderCatalog(['Holmes Homes','Holmes Homes','Holme Homes','Valor Holmes','Valor Holmes','Valor Homes','Weekley Homes']);
 assert.equal(cat.find('Holmes 328 Daybreak')?.name,'Holmes Homes');
 assert.equal(cat.find('HOLMES HOMES 201')?.name,'Holmes Homes');
 assert.equal(cat.find('Valor Holmes')?.name,'Valor Homes','a typo spelling never becomes the canonical name');
 assert.equal(cat.find('DAVID WEEKLEY')?.name,'Weekley Homes');
 assert.equal(cat.find('Titan Construction'),null);
 assert.equal(sharedBuilderCore(builderCore('Cash Customers')),false);
 assert.equal(sharedBuilderCore('holmes'),true);
});

test('jobs attach to the contacts builder; the job page lists that builder\'s people',()=>{
 const d=buildDirectory(data,JOBS);
 assert.equal(d.jobs.find(j=>j.id==='wj').builder,'Weekley Homes');
 assert.equal(d.jobs.find(j=>j.id==='hj').builder,'Holmes Homes');
 assert.equal(d.contacts.find(c=>c.key===HOLME.key).builder_key,d.contacts.find(c=>c.key===HOLMES.key).builder_key,'typo builder groups with the real one');
 assert.ok(d.builders.includes('Holmes Homes')&&!d.builders.includes('Holme Homes'));
 const view=id=>jobContactsView({directory:d,job:d.jobs.find(j=>j.id===id),rawJob:JOBS.find(j=>j.id===id)});
 const w=view('wj').builder_contacts.map(c=>c.name);
 assert.deepEqual(w,['Wes Pm','Wendy Office'],'PM first, job-specific contact for another lot excluded');
 const h=view('hj').builder_contacts;
 assert.deepEqual(h.map(c=>c.role),['superintendent','project_manager','builder','site']);
 assert.deepEqual(view('cj').builder_contacts,[],'cash customers never share contacts');
 assert.equal(contactRole(AMIEE),'builder','a company owner is builder side, not a homeowner');
});

test('calendar SPR lines: parsed next to the label, strong for a known phone, addable when unknown',()=>{
 assert.deepEqual(sprContacts('SPR: Chris\n\n  *   Phone: 435-555-4309\n\nISR: Toni\n\n  *   Phone: 801.555.1198').map(s=>[s.name,s.phone_key]),[['Chris','+14355554309']]);
 assert.deepEqual(sprContacts('SPR:  COLTON 801-555-4735\nISR: RAGEN').map(s=>s.name),['Colton']);
 assert.equal(sprContacts('SPR: Amy 801-555-1593\n * Email: amy@ivory.com\nISR: Kay kay@bfs.com')[0].email,'amy@ivory.com');
 assert.equal(sprContacts('ISR: Kay 801-555-0000\nSPR: Amy 801-555-1593')[0].email,'');
 assert.deepEqual(sprContacts('talked to the super Chris 801-555-1111 today. SPR: TBD'),[]);
 const d=buildDirectory(data,JOBS);
 const events=[{id:'e1',event_date:'2026-09-01',scope_notes:'SPR: Hank 801-555-0104\nISR: Toni 801-555-0102'},{id:'e2',event_date:'2026-09-02',scope_notes:'SPR: Newguy Person 801-555-0999'}];
 const v=jobContactsView({directory:d,job:d.jobs.find(j=>j.id==='hj'),rawJob:HJOB,events});
 const hank=v.suggestions.find(s=>s.contact?.key===HOLMES.key);
 assert.equal(hank.role,'superintendent');assert.equal(hank.confidence,'high');
 assert.ok(!v.suggestions.some(s=>s.contact?.key===WOFFICE.key),'another builder\'s office phone in the notes is not proposed');
 const add=v.suggestions.find(s=>s.spr);assert.equal(add.spr.name,'Newguy Person');assert.equal(add.needs,'add_contact');
 const cov={suggested:[{id:'hj',name:'Holmes 328',status:{missing_superintendent:true},suggestions:v.suggestions.filter(s=>s.spr)}]};
 assert.deepEqual(calendarSuperAdds(cov).map(x=>x.contact.name),['Newguy Person']);
 cov.suggested[0].suggestions=v.suggestions;assert.deepEqual(calendarSuperAdds(cov),[],'a strong directory super wins over adding a new one');
});

test('events reach jobs through billing lines and unique exact names, never shared names',()=>{
 const jobs=[{id:'a',canonical_name:'Alpha 1'},{id:'b',canonical_name:'Dup'},{id:'c',canonical_name:'Dup'}];
 const events=[{id:'1',google_event_id:'g1'},{id:'2',job_name:'alpha 1 '},{id:'3',job_name:'Dup'},{id:'4',job_id:'b'}];
 const m=eventsByJob(events,jobs,[{job_id:'a',calendar_event_id:'g1'}]);
 assert.deepEqual(m.get('a').map(e=>e.id).sort(),['1','2']);
 assert.deepEqual(m.get('b').map(e=>e.id),['4']);
 assert.equal(m.has('c'),false);
});

test('cleanup proposes confident merges, flags shared emails, and fills builder / role from evidence',()=>{
 assert.equal(namesCompatible('Matt','Matt Klingler'),true);
 assert.equal(namesCompatible('Amiee Kelly','Kelly Staheli'),false);
 const d=buildDirectory(data,JOBS);
 const plan=planContactCleanup({contacts:d.contacts,links:[{contact_key:MATT.key,job_id:'wj',role:'site'}],events:[{scope_notes:'SPR: Nate 801-555-0107'}],jobs:d.jobs});
 const merge=plan.items.find(i=>i.type==='merge'&&i.confidence==='high');
 assert.equal(merge.survivor.key,MATTK.key,'the full name survives');assert.deepEqual(merge.merge.map(m=>m.key),[MATT.key]);
 assert.deepEqual(merge.result.aliases,['Matt']);assert.equal(merge.result.links,1);
 const review=plan.items.find(i=>i.type==='merge'&&i.confidence==='review');
 assert.deepEqual([review.survivor.key,...review.merge.map(m=>m.key)].sort(),[AMIEE.key,KELLY.key].sort());
 const b=plan.items.find(i=>i.type==='builder');assert.equal(b.contact.key,NOBUILDER.key);assert.equal(b.builder,'Weekley Homes');assert.equal(b.confidence,'high');assert.equal(b.company,'Weekley Homes');
 const r=plan.items.find(i=>i.type==='role');assert.equal(r.contact.key,NOROLE.key);assert.equal(r.role,'superintendent');
 assert.equal(plan.summary.confident_merges,1);assert.equal(plan.summary.duplicate_groups,2);
});

test('overrides patch workbook contacts; merged contacts resolve to the survivor',()=>{
 const every=applyContactOverlay([MATT,MATTK],[{id:'h1',key:MATT.key,name:'Matt',source:'override',status:'merged',merged_into:MATTK.key},{id:'h2',key:MATTK.key,name:'Matt Klingler',source:'override',aliases:['Matt'],role:'project_manager'},{id:'h3',key:'z'.repeat(64),name:'Gone',source:'override'},{id:'h4',key:'y'.repeat(64),name:'Hub Person',source:'hub'}]);
 assert.equal(every.length,3,'stale override rows are dropped; hub contacts are kept');
 assert.equal(resolveContact(every,MATT.key).key,MATTK.key);
 assert.deepEqual(every.find(c=>c.key===MATTK.key).aliases,['Matt']);
 assert.equal(every.find(c=>c.key===MATTK.key).company,MATTK.company,'unset override fields keep the workbook value');
});

test('homeowner: customer name prefill only for a person; pick order saved > linked > strong suggestion > prefill',()=>{
 assert.equal(homeownerPrefill({builder:'DAVID WEEKLEY',customer_name:'DAVID WEEKLEY'}),null);
 assert.equal(homeownerPrefill({builder:'',customer_name:'INTEGRATION TEST — no customer order'}),null);
 assert.equal(homeownerPrefill({builder:'BRIAN BEITZEL',customer_name:'3 Strings Arena'}),null);
 assert.deepEqual(homeownerPrefill({builder:'Cadence Homes',customer_name:'Westly (tenant)'}),{name:'Westly',note:'tenant',source:'customer_name'});
 assert.equal(homeownerPrefill({builder:null,customer_name:'Justin Hutchins'}).name,'Justin Hutchins');
 const job={builder:'X',customer_name:'Jody Howe'};
 assert.equal(pickHomeowner({job}).source,'job');
 const sug={role:'homeowner',confidence:'high',contact:{key:'k1',name:'Jo H'},reasons:['r']};
 assert.equal(pickHomeowner({job,view:{suggestions:[sug,{...sug,confidence:'medium',contact:{key:'k2'}}]}}).key,'k1');
 assert.equal(pickHomeowner({job,view:{linked:[{key:'k3',name:'Cu',role:'customer'}],suggestions:[sug]}}).key,'k3');
 assert.equal(pickHomeowner({saved:{key:'k4',name:'Saved'},job}).source,'linked');
 assert.equal(pickHomeowner({}),null);
 assert.equal(pickSuper({view:{linked:[{key:'h',name:'Home Owner',role:'homeowner',phone:'801-555-0100'}]}}),null,'the homeowner never fills the super slot');
});

async function setup(){
 const tables={ContactDirectorySnapshot:[],HubContacts:[],ContactJobLink:[],Jobs:structuredClone(JOBS),MessageConversation:[],CalendarEvents:[],FeeLines:[],JobNotes:[],QuoteRequests:[]},api={};let user={role:'admin',email:'gabefronk@gmail.com'};let n=0;
 for(const [name,rows]of Object.entries(tables))api[name]={list:async(sort,limit=500,skip=0)=>rows.slice(skip,skip+limit),filter:async(q,sort,limit=500)=>rows.filter(r=>Object.entries(q).every(([k,v])=>r[k]===v)).slice(0,limit),get:async id=>rows.find(r=>r.id===id),create:async r=>{const row={...structuredClone(r),id:name+(n++)};rows.push(row);return row},update:async(id,patch)=>{const r=rows.find(x=>x.id===id);Object.assign(r,structuredClone(patch));return r},delete:async id=>{const i=rows.findIndex(r=>r.id===id);if(i>=0)rows.splice(i,1)}};
 const content=canonicalJson(data),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
 tables.ContactDirectorySnapshot.push({id:'snap',directory_data:structuredClone(data),content_sha256:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')});
 const handler=createContactsDirectoryHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:api,integrations:{}}})});
 return {tables,setUser:u=>user=u,call:async body=>{const r=await handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}

test('cleanup apply is owner-only, keeps every detail, repoints links and never deletes a contact',async()=>{
 const s=await setup();
 s.tables.ContactJobLink.push({id:'l1',contact_key:MATT.key,job_id:'wj',role:'site'},{id:'l2',contact_key:MATT.key,job_id:'hj',role:''},{id:'l3',contact_key:MATTK.key,job_id:'hj',role:''});
 s.setUser({role:'user',email:'crew@example.com'});
 assert.equal((await s.call({action:'cleanup_plan'})).status,403);
 assert.equal((await s.call({action:'cleanup_apply',ids:['x']})).status,403);
 s.setUser({role:'admin',email:'gabefronk@gmail.com'});
 const plan=(await s.call({action:'cleanup_plan'})).body;
 assert.equal(s.tables.HubContacts.length,0,'planning writes nothing');
 const merge=plan.items.find(i=>i.type==='merge'&&i.confidence==='high');
 const res=(await s.call({action:'cleanup_apply',ids:[merge.id,'merge:stale']})).body;
 assert.deepEqual(res.applied,[merge.id]);assert.deepEqual(res.skipped,['merge:stale']);
 const gone=s.tables.HubContacts.find(r=>r.key===MATT.key);assert.equal(gone.status,'merged');assert.equal(gone.merged_into,MATTK.key);
 const kept=s.tables.HubContacts.find(r=>r.key===MATTK.key);assert.deepEqual(kept.aliases,['Matt']);assert.deepEqual(kept.merged_keys,[MATT.key]);
 assert.deepEqual(s.tables.ContactJobLink.map(l=>[l.contact_key===MATTK.key,l.job_id,l.role]).sort(),[[true,'hj','site'==='x'?'':''],[true,'wj','site']].sort(),'links moved; the duplicate job link folds into the existing one');
 const dir=(await s.call({action:'directory'})).body;
 assert.ok(!dir.contacts.some(c=>c.key===MATT.key),'merged contact hidden');
 assert.equal(dir.contacts.find(c=>c.key===MATTK.key).link_count,2);
 assert.equal((await s.call({action:'contact',contact_key:MATT.key})).body.contact.key,MATTK.key,'old key resolves to the survivor');
 const again=(await s.call({action:'cleanup_plan'})).body;assert.ok(!again.items.some(i=>i.id===merge.id));
 const role=again.items.find(i=>i.type==='builder');
 await s.call({action:'cleanup_apply',ids:[role.id]});
 assert.equal(s.tables.HubContacts.find(r=>r.key===NOBUILDER.key).builder,'Weekley Homes');
 assert.equal(s.tables.HubContacts.filter(r=>r.status==='merged').length,1);
});

test('homeowner slot: crew can read and set it; one homeowner per job; picks and reuses contacts',async()=>{
 const s=await setup();s.setUser({role:'user',email:'crew@example.com'});
 const first=await s.call({action:'job_homeowner',job_id:'cj'});
 assert.equal(first.status,200);assert.equal(first.body.homeowner,null);assert.equal(first.body.prefill.name,'Todd Barker');
 assert.equal((await s.call({action:'set_job_homeowner',job_id:'cj',contact:{name:'Todd Barker'}})).status,400,'a phone or email is required');
 const saved=(await s.call({action:'set_job_homeowner',job_id:'cj',contact:{name:'Todd Barker',phone:'(714) 555-9887'}})).body.homeowner;
 assert.equal(saved.name,'Todd Barker');
 const hub=s.tables.HubContacts.find(r=>r.key===saved.key);assert.equal(hub.role,'homeowner');assert.equal(hub.company,'Homeowner');
 assert.deepEqual(s.tables.ContactJobLink.map(l=>[l.contact_key,l.job_id,l.role]),[[saved.key,'cj','homeowner']]);
 assert.equal((await s.call({action:'job_homeowner',job_id:'cj'})).body.homeowner.key,saved.key);
 // Same phone later reuses the contact; choosing another contact replaces the homeowner.
 await s.call({action:'set_job_homeowner',job_id:'wj',contact:{name:'T Barker',phone:'714-555-9887'}});
 assert.equal(s.tables.HubContacts.length,1);
 await s.call({action:'set_job_homeowner',job_id:'cj',contact_key:CASH.key});
 assert.deepEqual(s.tables.ContactJobLink.filter(l=>l.job_id==='cj'&&l.role==='homeowner').map(l=>l.contact_key),[CASH.key]);
 await s.call({action:'set_job_homeowner',job_id:'cj',remove:true});
 assert.equal((await s.call({action:'job_homeowner',job_id:'cj'})).body.homeowner,null);
 assert.equal((await s.call({action:'directory'})).status,403,'crew still cannot open the directory');
 // A new super from the job page is filed under the job's builder.
 const sup=(await s.call({action:'set_job_super',job_id:'hj',contact:{name:'Newguy',phone:'801-555-0999'}})).body.super;
 const row=s.tables.HubContacts.find(r=>r.key===sup.key);assert.equal(row.builder,'Holmes Homes');assert.equal(row.company,'Holmes Homes - Super');
});

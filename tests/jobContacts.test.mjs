import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {buildDirectory} from '../base44/shared/contactMatching.js';
import {contactRole,nameMatchesSeed,seedJobMatch,jobFacts,jobContactsView,jobContactCoverage,highConfidenceSingleCandidateLinks} from '../base44/shared/jobContacts.js';
import {CONTACT_LINK_SEEDS} from '../base44/shared/contactLinkSeeds.js';
import {createContactsDirectoryHandler} from '../base44/shared/contactsDirectory.js';
import {groupByRole,viewFromLegacy,confirmRoleOf,statusOf} from '../src/lib/jobContacts.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const person=(k,name,company,phone='')=>{const digits=phone.replace(/\D/g,'');return {key:k.repeat(64),row:2,name,builder:company.split(' - ')[0],company,phone,phone_key:digits.length===10?'+1'+digits:'',email:'',email_key:'',note:'',review_note:''};};
const MAKAY=person('a','Makay Jensen','Holmes Homes','(801) 696-6077');
const DAVIES=person('b','Dave Davies','Holmes Homes - Daybreak Super','(801) 555-0110');
const PM=person('c','Pat Manager','Holmes Homes - PM','(801) 555-0120');
const SITE=person('d','Sam Site','Holmes Homes - Daybreak 607','(801) 555-0130');
const TEXTER=person('e','Tina Texter','Holmes Homes - Warranty','(801) 555-0199');
const EDGE=person('f','Ed Edge','Edge Homes - Super','(801) 555-0140');
const data={version:1,source:{filename:'contacts.xlsm',workbook_sha256:'9'.repeat(64),captured_at:'2026-09-18T12:00:00Z',location:'Test copy'},contacts:[MAKAY,DAVIES,PM,SITE,TEXTER,EDGE],job_references:[]};
const J607={id:'j607',canonical_name:'Holmes Homes - 607 Daybreak Move Up',builder:'Holmes Homes',address:'6847 W Ripple Rd, South Jordan',aliases:[],po_numbers:[],oe_numbers:[]};
const J395={id:'j395',canonical_name:'Holmes Homes - Daybreak Towns 395-397',builder:'Holmes',address:'11356 S Watercourse Rd, South Jordan',aliases:[],po_numbers:[],oe_numbers:[]};
const DECOY={id:'jdecoy',canonical_name:'Other Builder - 607 Daybreak',builder:'Other Builder',address:'6847 W Pine Rd',aliases:[],po_numbers:[],oe_numbers:[]};
const EDGEJOB={id:'jedge',canonical_name:'Edge Homes - Lot 9 Oak Hollow',builder:'Edge Homes',address:'1 Main St',aliases:[],po_numbers:[],oe_numbers:[]};
const JOBS=[J607,J395,DECOY,EDGEJOB];
const view=(jobId,{links=[],conversations=[],dir=data,seeds=CONTACT_LINK_SEEDS}={})=>{const directory=buildDirectory(dir,JOBS,links);return jobContactsView({directory,job:directory.jobs.find(j=>j.id===jobId),rawJob:JOBS.find(j=>j.id===jobId),links,conversations,seeds});};
const byContact=(v,c)=>v.suggestions.find(s=>s.contact?.key===c.key);

test('roles come from the workbook company label',()=>{
 assert.equal(contactRole(DAVIES),'superintendent');
 assert.equal(contactRole(PM),'project_manager');
 assert.equal(contactRole(MAKAY),'builder');
 assert.equal(contactRole(SITE),'site');
 assert.equal(contactRole(person('1','Hana Owner','Holmes Homes - Homeowner')),'homeowner');
 assert.equal(contactRole(person('2','Sue','Holmes Homes - Supt Daybreak')),'superintendent');
});

test('seed names allow listed variants and one adjacent swap, nothing looser',()=>{
 const davis=CONTACT_LINK_SEEDS.find(s=>s.name==='Davis');
 assert.equal(nameMatchesSeed('Dave Davies',davis),true);
 assert.equal(nameMatchesSeed('Jon Dvais',davis),true);
 assert.equal(nameMatchesSeed('Mike Davis',davis),true);
 assert.equal(nameMatchesSeed('David Smith',davis),false);
 assert.equal(nameMatchesSeed('Davi',davis),false);
 assert.equal(nameMatchesSeed('Makay',CONTACT_LINK_SEEDS.find(s=>s.name==='Makay')),true);
});

test('seeds match only their own job by name, address and builder',()=>{
 const [davis,makay]=CONTACT_LINK_SEEDS;const d=buildDirectory(data,JOBS);
 const facts=id=>jobFacts(d.jobs.find(j=>j.id===id),JOBS.find(j=>j.id===id));
 assert.equal(seedJobMatch(makay,facts('j607')),'name and address');
 assert.equal(seedJobMatch(davis,facts('j395')),'name and address');
 assert.equal(seedJobMatch(makay,facts('jdecoy')),'');
 assert.equal(seedJobMatch(davis,facts('j607')),'');
 assert.equal(seedJobMatch(makay,facts('jedge')),'');
 // Address alone is enough when the builder agrees, even if the job name is written differently.
 assert.equal(seedJobMatch(makay,jobFacts({id:'x',name:'Holmes Homes - Ripple lot',address:'6847 West Ripple Road',builder:'Holmes Homes',builder_key:'holmes home',groups:[]},null)),'address');
});

test('job view joins linked contacts and flags a missing superintendent',()=>{
 const v=view('j607');
 assert.deepEqual(v.linked.map(c=>[c.name,c.role,c.link]),[['Sam Site','site','workbook']]);
 assert.deepEqual(v.status,{linked:1,superintendents:0,missing_contact:false,missing_superintendent:true,suggestions:v.suggestions.length});
 const makay=byContact(v,MAKAY);
 assert.equal(makay.confidence,'high');assert.equal(makay.role,'superintendent');assert.equal(makay.already_linked,false);
 assert.match(makay.reasons[0],/Owner note: Makay is the superintendent/);
 assert.equal(v.suggestions[0].contact.key,MAKAY.key,'the known-good superintendent is proposed first');
 assert.equal(byContact(v,DAVIES).confidence,'medium');
 assert.equal(byContact(v,EDGE),undefined,'another builder\'s superintendent is never proposed');
 assert.equal(byContact(v,PM),undefined,'a builder-wide PM is not assigned to every job');
});

test('an unconfirmed seed name needs the owner to choose the directory contact',()=>{
 const conversations=[{job_id:'j395',title:'Daybreak towns',participants:['+1 (801) 555-0199','801-555-0142']},{job_id:'j607',title:'Other job',participants:['8015550120']}];
 const v=view('j395',{conversations});
 const seed=v.suggestions.find(s=>s.seed?.name==='Davis');
 assert.equal(seed.needs,'choose_contact');assert.equal(seed.seed.name_verified,false);
 assert.deepEqual(seed.candidates.map(c=>c.key),[DAVIES.key]);
 assert.ok(seed.reasons.some(r=>/spelling is unconfirmed/.test(r)));
 const texter=byContact(v,TEXTER);assert.equal(texter.confidence,'medium');assert.deepEqual(texter.sources,['messages']);
 const unknown=v.suggestions.find(s=>s.participant);assert.equal(unknown.participant.phone,'+18015550142');assert.equal(unknown.needs,'add_contact');assert.equal(unknown.confidence,'low');
 assert.equal(byContact(v,PM),undefined,'threads linked to other jobs are ignored');
 assert.equal(v.status.missing_contact,true);
});

test('a saved superintendent link satisfies the job; a plain saved link can be promoted',()=>{
 const saved=view('j607',{links:[{contact_key:MAKAY.key,job_id:'j607',role:'superintendent',source:'suggestion'}]});
 const makay=saved.linked.find(c=>c.key===MAKAY.key);
 assert.deepEqual([makay.role,makay.link],['superintendent','saved']);
 assert.equal(saved.status.missing_superintendent,false);
 assert.equal(byContact(saved,MAKAY),undefined);
 const plain=view('j607',{links:[{contact_key:MAKAY.key,job_id:'j607',source:'manual'}]});
 assert.equal(plain.linked.find(c=>c.key===MAKAY.key).role,'builder');
 assert.equal(byContact(plain,MAKAY).already_linked,true);
 assert.equal(plain.status.missing_superintendent,true);
});

test('without a directory the job still shows a missing indicator and the unresolved owner note',()=>{
 const v=view('j607',{dir:{source:null,contacts:[],job_references:[]}});
 assert.equal(v.directory,false);assert.equal(v.status.missing_contact,true);
 const seed=v.suggestions.find(s=>s.seed);
 assert.deepEqual([seed.seed.name,seed.seed.phone,seed.needs,seed.candidates.length],['Makay','+18016966077','add_contact',0]);
});

test('coverage counts missing contacts and superintendents and reports unmatched owner notes',()=>{
 const directory=buildDirectory(data,[J607,EDGEJOB]);
 const c=jobContactCoverage({directory,rawJobs:[J607,EDGEJOB],seeds:CONTACT_LINK_SEEDS});
 assert.deepEqual({jobs:c.summary.jobs,with:c.summary.with_contacts,missing:c.summary.missing_contacts,noSuper:c.summary.missing_superintendent},{jobs:2,with:1,missing:1,noSuper:2});
 assert.deepEqual(c.missing.map(j=>j.id),['jedge']);
 assert.deepEqual(c.suggested.map(j=>j.id),['j607']);
 assert.deepEqual(c.unmatched_seeds.map(s=>s.name),['Davis']);
});

test('homeowner proposals use job surname, exact customer name and job phone signals',()=>{
 const barker=person('7','Todd Barker','Cash Customer','(714) 598-9887');
 const jobs=[{id:'barker',canonical_name:'barker - amsco will-call pickup',builder:'',address:'',aliases:[],po_numbers:[],oe_numbers:[]}];
 const dirData={...data,contacts:[...data.contacts,barker]};const directory=buildDirectory(dirData,jobs);
 const make=raw=>jobContactsView({directory,job:directory.jobs[0],rawJob:{...jobs[0],...raw},seeds:[]});
 const surname=byContact(make({}),barker);assert.equal(surname.role,'homeowner');assert.equal(surname.confidence,'medium');assert.match(surname.reasons.join(' '),/Surname "barker"/);
 const named=byContact(make({customer_name:'Todd Barker'}),barker);assert.equal(named.confidence,'high');assert.ok(named.sources.includes('customer_name'));
 const phoned=byContact(make({customer_phone:'714-598-9887'}),barker);assert.equal(phoned.confidence,'high');assert.ok(phoned.sources.includes('job'));
});

test('builder staff surname collisions are not homeowner suggestions on builder jobs',()=>{
 const staff=person('8','Jo Jones','Holmes Homes - PM');
 const job={id:'jj',canonical_name:'Holmes Homes - Jones lot 8',builder:'Holmes Homes',address:'',aliases:[],po_numbers:[],oe_numbers:[]};
 const d={...data,contacts:[...data.contacts,staff]};const directory=buildDirectory(d,[job]);
 const v=jobContactsView({directory,job:directory.jobs[0],rawJob:job,seeds:[]});
 assert.equal(byContact(v,staff),undefined);
});

test('already-linked contacts are not re-suggested by homeowner signals',()=>{
 const barker=person('7','Todd Barker','Cash Customer','(714) 598-9887');const job={id:'b',canonical_name:'Barker pickup',builder:'',address:'',customer_name:'Todd Barker',aliases:[],po_numbers:[],oe_numbers:[]};
 const links=[{contact_key:barker.key,job_id:'b',role:'homeowner'}],directory=buildDirectory({...data,contacts:[barker]},[job],links);
 const v=jobContactsView({directory,job:directory.jobs[0],rawJob:job,links,seeds:[]});assert.equal(byContact(v,barker),undefined);
});

test('bulk links include only high-confidence single-candidate roles',()=>{
 const coverage={suggested:[{id:'j1',name:'One',suggestions:[{confidence:'high',role:'homeowner',contact:{key:'a',name:'Alice'},reasons:['exact']}]},{id:'j2',name:'Two',suggestions:[{confidence:'high',role:'homeowner',contact:{key:'b',name:'Bob'},reasons:[]},{confidence:'high',role:'homeowner',contact:{key:'c',name:'Carol'},reasons:[]},{confidence:'medium',role:'superintendent',contact:{key:'d',name:'Dan'},reasons:[]}]}]};
 assert.deepEqual(highConfidenceSingleCandidateLinks(coverage).map(x=>[x.job_id,x.contact_key,x.role]),[['j1','a','homeowner']]);
});

test('frontend helpers group roles and adapt the older job response',()=>{
 assert.deepEqual(groupByRole([{role:'builder'},{role:'site'},{role:'superintendent'}]).map(([r])=>r),['superintendent','site','builder']);
 const legacy=viewFromLegacy({contacts:[{...DAVIES,manual_job_ids:['j1']},{...SITE,manual_job_ids:[]}]},'j1');
 assert.deepEqual(legacy.linked.map(c=>[c.role,c.link]),[['superintendent','saved'],['site','workbook']]);
 assert.equal(legacy.status.missing_superintendent,false);assert.equal(legacy.legacy,true);
 assert.deepEqual(statusOf([]),{linked:0,superintendents:0,missing_contact:true,missing_superintendent:true,suggestions:0});
 assert.equal(confirmRoleOf({role:'superintendent'}),'superintendent');assert.equal(confirmRoleOf({role:'site'}),'site');assert.equal(confirmRoleOf({role:'builder'}),'builder');assert.equal(confirmRoleOf({role:'customer'}),'customer');
});

async function setup({conversationsFail=false}={}){
 const tables={ContactDirectorySnapshot:[],HubContacts:[],ContactJobLink:[],Jobs:structuredClone(JOBS),MessageConversation:[{id:'m1',conversation_key:'k1',job_id:'j395',title:'Daybreak towns',participants:['8015550199']}]},api={},writes=[];let user={role:'admin',email:'gabefronk@gmail.com'};let storedFile='';
 for(const [name,rows]of Object.entries(tables)){api[name]={list:async(sort,limit=500,skip=0)=>[...rows].reverse().slice(skip,skip+limit),filter:async(q,sort,limit=500)=>{if(name==='MessageConversation'&&conversationsFail)throw Error('boom');return rows.filter(r=>Object.entries(q).every(([k,v])=>r[k]===v)).slice(0,limit);},get:async id=>rows.find(r=>r.id===id),create:async r=>{writes.push([name,'create']);const row={...structuredClone(r),id:name+rows.length};rows.push(row);return row},update:async(id,patch)=>{writes.push([name,'update']);Object.assign(rows.find(r=>r.id===id),patch)},delete:async id=>{writes.push([name,'delete']);const i=rows.findIndex(r=>r.id===id);if(i>=0)rows.splice(i,1)}};}
 const integrations={Core:{UploadPrivateFile:async({file})=>{storedFile=await file.text();return {file_uri:'private://directory'}},CreateFileSignedUrl:async()=>({signed_url:'https://example.invalid/private-directory'})}};
 const handler=createContactsDirectoryHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:api,integrations}}),fetchFile:async()=>new Response(storedFile)});
 const call=async body=>handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)}));
 return {tables,writes,call,setUser:u=>user=u,importDirectory:async()=>{await call({action:'import',directory:data});writes.length=0;}};
}

test('job views are owner-only and read-only',async()=>{
 const s=await setup();await s.importDirectory();
 for(const u of [null,{role:'admin',email:'someone@example.com'},{role:'user',email:'gabefronk@gmail.com'}]){s.setUser(u);const expected=u?403:401;assert.equal((await s.call({action:'job_contacts',job_id:'j607'})).status,expected);assert.equal((await s.call({action:'job_contact_coverage'})).status,expected);}
 s.setUser({role:'admin',email:'gabefronk@gmail.com'});
 const r=await s.call({action:'job_contacts',job_id:'j395'});assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.status.missing_contact,true);assert.equal(body.messages,'available');
 assert.ok(body.suggestions.some(x=>x.contact?.key===TEXTER.key),'message threads linked to the job are used');
 assert.equal(JSON.stringify(body).includes('private://'),false);
 const cov=await(await s.call({action:'job_contact_coverage'})).json();
 assert.equal(cov.summary.jobs,4);assert.ok(cov.summary.missing_superintendent>=1);
 assert.equal((await s.call({action:'job_contacts',job_id:'missing'})).status,404);
 assert.deepEqual(s.writes,[],'viewing never writes');assert.equal(s.tables.ContactJobLink.length,0);
});

test('job views work before a directory import and when message threads fail',async()=>{
 const s=await setup({conversationsFail:true});
 const body=await(await s.call({action:'job_contacts',job_id:'j607'})).json();
 assert.equal(body.directory,false);assert.equal(body.messages,'unavailable');
 assert.equal(body.suggestions.find(x=>x.seed)?.needs,'add_contact');
 assert.equal((await s.call({action:'directory'})).status,200,'other actions keep their empty response');
 assert.deepEqual(s.writes,[]);
});

test('confirming a suggestion writes one link with its role; unsupported roles are refused',async()=>{
 const s=await setup();await s.importDirectory();
 assert.equal((await s.call({action:'link',contact_key:MAKAY.key,job_id:'j607',role:'boss'})).status,400);
 assert.equal(s.tables.ContactJobLink.length,0);
 assert.equal((await s.call({action:'link',contact_key:MAKAY.key,job_id:'j607'})).status,200);
 assert.deepEqual({...s.tables.ContactJobLink[0],id:undefined},{contact_key:MAKAY.key,job_id:'j607',source:'manual',id:undefined});
 await s.call({action:'link',contact_key:MAKAY.key,job_id:'j607',role:'superintendent',source:'suggestion'});
 assert.equal(s.tables.ContactJobLink.length,1);assert.equal(s.tables.ContactJobLink[0].role,'superintendent');
 const body=await(await s.call({action:'job_contacts',job_id:'j607'})).json();
 assert.equal(body.linked.find(c=>c.key===MAKAY.key).role,'superintendent');assert.equal(body.status.missing_superintendent,false);
 await s.call({action:'link',contact_key:DAVIES.key,job_id:'j395',role:'superintendent',source:'suggestion'});
 assert.deepEqual(s.tables.ContactJobLink.map(l=>[l.contact_key[0],l.job_id,l.source,l.role]),[['a','j607','manual','superintendent'],['b','j395','suggestion','superintendent']]);
});

test('saved customer role overrides a generic builder company label',()=>{const links=[{contact_key:MAKAY.key,job_id:'j607',role:'customer'}];const v=view('j607',{links});assert.equal(v.linked.find(c=>c.key===MAKAY.key)?.role,'customer');});

test('any signed-in user can save and read the super for one job, reusing a matching contact',async()=>{
 const s=await setup();await s.importDirectory();
 s.setUser({role:'user',email:'crew@example.com'});
 assert.equal((await s.call({action:'job_contacts',job_id:'j607'})).status,403,'the full view stays owner-only');
 let r=await s.call({action:'job_super',job_id:'j607'});assert.equal(r.status,200);assert.equal((await r.json()).super,null);
 assert.equal((await s.call({action:'set_job_super',job_id:'j607',contact:{name:'Nobody'}})).status,400,'needs a phone or email');
 r=await s.call({action:'set_job_super',job_id:'j607',contact:{name:'Dave D',phone:'801-555-0110'}});assert.equal(r.status,200);
 assert.equal((await r.json()).super.key,DAVIES.key,'same phone reuses the directory contact');
 r=await s.call({action:'set_job_super',job_id:'j607',contact:{name:'Mike Shaw',phone:'385-230-1483',email:'mikes@fieldstonehomes.com'}});
 const saved=(await r.json()).super;assert.equal(saved.name,'Mike Shaw');
 const sup=s.tables.ContactJobLink.filter(l=>l.job_id==='j607'&&l.role==='superintendent');
 assert.deepEqual(sup.map(l=>l.contact_key),[saved.key],'one super per job');
 const read=await(await s.call({action:'job_super',job_id:'j607'})).json();
 assert.deepEqual(read.super,{key:saved.key,name:'Mike Shaw',phone:'385-230-1483',email:'mikes@fieldstonehomes.com'});
 s.setUser(null);assert.equal((await s.call({action:'job_super',job_id:'j607'})).status,401);
});

import {buildDirectory,matchingContacts} from './contactMatching.js';
const owners=new Set(['gabefronk@gmail.com','gabriel.fronk.wd@gmail.com']);
const owner=u=>u?.role==='admin'&&owners.has(String(u.email||'').toLowerCase().trim());
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export const canonicalJson=value=>Array.isArray(value)?'['+value.map(canonicalJson).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}':JSON.stringify(value);
const response=(data,status=200)=>Response.json(data,{status});
async function all(entity,sort='-created_date'){const result=[];for(let skip=0;skip<50000;skip+=500){const page=await entity.list(sort,500,skip);result.push(...page);if(page.length<500)return result;}throw Error('Directory exceeds supported size.');}
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
   const client=await getClient(req);if(!owner(await client.auth.me().catch(()=>null)))return response({error:'Owner access required.'},403);
   const text=await req.text();if(text.length>5000000)return response({error:'Directory file is too large.'},413);
   const input=JSON.parse(text),api=client.asServiceRole.entities;
   if(input.action==='import'){
    let data;try{data=validateDirectory(input.directory);}catch{return response({error:'This is not a valid contacts directory export.'},400);}
    const content=canonicalJson(data),digest=await hash(content);
    const existing=(await api.ContactDirectorySnapshot.filter({content_sha256:digest},'-created_date',1))[0];
    if(existing)return response({ok:true,duplicate:true,contacts:existing.contact_count,source:existing.filename});
    const {file_uri}=await client.asServiceRole.integrations.Core.UploadPrivateFile({file:new File([content],'contact-directory.json',{type:'application/json'})});if(!file_uri)throw Error('Upload failed');
    await api.ContactDirectorySnapshot.create({filename:data.source.filename,source_location:data.source.location,captured_at:data.source.captured_at,workbook_sha256:data.source.workbook_sha256,content_sha256:digest,data_file_uri:file_uri,contact_count:data.contacts.length,job_reference_count:data.job_references.length});
    cache.clear();cache.set(digest,data);return response({ok:true,contacts:data.contacts.length,source:data.source.filename});
   }
   const snapshot=(await api.ContactDirectorySnapshot.list('-created_date',1))[0];if(!snapshot)return response({empty:true,contacts:[],jobs:[],builders:[],summary:{contacts:0}});
   const data=await load(client,snapshot);
   if(input.action==='contact'){const contact=data.contacts.find(c=>c.key===input.contact_key);return contact?response({contact}):response({error:'Contact not found.'},404);}
   if(input.action==='link'){
    if(!data.contacts.some(c=>c.key===input.contact_key))return response({error:'Contact not found.'},404);
    const job=String(input.job_id||'').startsWith('workbook:')?buildDirectory(data,await all(api.Jobs)).jobs.find(j=>j.id===input.job_id):await api.Jobs.get(input.job_id).catch(()=>null);if(!job)return response({error:'Select an existing job.'},400);
    const query={contact_key:input.contact_key,job_id:job.id};const prior=(await api.ContactJobLink.filter(query,'-created_date',1))[0];
    if(input.remove===true){if(prior)await api.ContactJobLink.delete(prior.id);}else if(!prior)await api.ContactJobLink.create({...query,source:'manual'});
    return response({ok:true});
   }
   const [jobs,links]=await Promise.all([all(api.Jobs),all(api.ContactJobLink)]);const directory=buildDirectory(data,jobs,links);
   if(input.action==='conversation'){
    const c=(await api.MessageConversation.filter({conversation_key:String(input.conversation_key||'')},'-created_date',1))[0];if(!c)return response({error:'Conversation not found.'},404);
    const matches=matchingContacts(directory.contacts,c.participants);const builderKeys=new Set(matches.map(c=>c.builder_key).filter(Boolean));
    return response({contacts:matches,jobs:directory.jobs.filter(j=>builderKeys.has(j.builder_key)||matches.some(c=>c.job_ids.includes(j.id))),source:directory.source});
   }
   if(input.action==='directory')return response(directory);
   return response({error:'Unsupported action.'},400);
  }catch(error){console.error('Contacts directory failed',error?.name||'Error');return response({error:'Contacts could not be loaded. Please retry.'},500);}
 };
}

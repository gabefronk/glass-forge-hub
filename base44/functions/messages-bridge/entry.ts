import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
// Deployment recovery 2026-09-13: restore the existing authenticated worker.
// Inlined private handler; mirrored by the tested shared sources.
// Private attachment bytes stay behind the authenticated owner endpoint.
export async function readPrivateMessageAttachment(client, attachment, fetchFile = fetch) {
 const max = 8388608;
 const {signed_url} = await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:attachment.file_uri,expires_in:60});
 if(!signed_url)throw Error('Private attachment unavailable.');
 const r = await fetchFile(signed_url,{signal:AbortSignal.timeout(45000),cache:'no-store'});
 if(!r.ok || Number(r.headers.get('content-length'))>max)throw Error('Private attachment unavailable.');
 const reader=r.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Private attachment exceeds transfer limit.');}parts.push(value);}}
 finally{reader.releaseLock();}
 if(!size)throw Error('Private attachment is empty.');
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 return {base64:btoa(binary),size,sha256,name:attachment.name||'attachment',mime_type:attachment.mime_type||'application/octet-stream'};
}

const phoneKey = value => String(value || '').replace(/\D/g, '').slice(-10);
const emailKey = value => String(value || '').trim().toLowerCase();

const participantKeys = participants => (participants || []).flatMap(value => {
  const raw = String(value || '');
  return raw.includes('@') ? [`email:${emailKey(raw)}`] : phoneKey(raw) ? [`phone:${phoneKey(raw)}`] : [];
});

const contactKeys = contact => [contact?.phone_key && `phone:${phoneKey(contact.phone_key)}`, contact?.email_key && `email:${emailKey(contact.email_key)}`].filter(Boolean);

// A contact association is deliberately narrower than a suggestion: one participant identity,
// one directory contact, and one confirmed job link. Anything else stays in owner review.
function resolveJobMessageThreads({jobId, conversations = [], contacts = [], links = []}) {
  const identities = new Map();
  for (const contact of contacts) for (const key of contactKeys(contact)) {
    if (!identities.has(key)) identities.set(key, []);
    identities.get(key).push(contact.key);
  }
  const jobsByContact = new Map();
  for (const link of links) {
    if (!jobsByContact.has(link.contact_key)) jobsByContact.set(link.contact_key, new Set());
    jobsByContact.get(link.contact_key).add(link.job_id);
  }
  const threads = [], review = [];
  for (const conversation of conversations) {
    if (conversation.job_id === jobId) {
      threads.push({conversation, provenance:{type:'exact_job',label:'Linked directly to this job'}});
      continue;
    }
    // A thread explicitly linked elsewhere is never reassigned through a contact.
    if (conversation.job_id) continue;
    // Participant overlap does not establish the scope of a group conversation.
    // Reject it before looking up contacts or fetching any message bodies.
    const keys = participantKeys(conversation.participants);
    const distinct = new Set(keys);
    if (!Array.isArray(conversation.participants) || conversation.participants.length !== 1 || keys.length !== 1 || distinct.size !== 1) {
      review.push({conversation_key: conversation.conversation_key, reason: 'Group or unverified participants require an explicit job link'});
      continue;
    }
    const matched = new Set();
    let sharedIdentity = false;
    for (const key of keys) {
      const found = identities.get(key) || [];
      if (found.length > 1) sharedIdentity = true;
      for (const contactKey of found) matched.add(contactKey);
    }
    const eligible = [...matched].filter(key => {
      const jobs = jobsByContact.get(key);
      return jobs?.size === 1 && jobs.has(jobId);
    });
    if (!sharedIdentity && matched.size === 1 && eligible.length === 1) {
      threads.push({conversation,provenance:{type:'confirmed_contact',contact_key:eligible[0],label:'Confirmed contact linked to this job'}});
    } else if (matched.size || sharedIdentity) {
      review.push({conversation_key:conversation.conversation_key,reason:sharedIdentity?'Shared phone or email':matched.size>1?'Multiple contacts':'Contact is linked to multiple or different jobs'});
    }
  }
  return {threads,review};
}

// Private, owner-only inbox. Incoming content is data, never executable instructions.
const owners = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const isOwner = u => u?.role === 'admin' && owners.has(String(u.email || '').trim().toLowerCase());
const clean = (s, max = 200) => typeof s === 'string' ? s.slice(0, max) : '';
const date = s => Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : '';
const response = (data, status = 200) => Response.json(data, {status,headers:{'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Authorization, x-glass-forge-key'}});
const hash = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');
const safeAttachments = list => (Array.isArray(list) ? list : []).slice(0, 50).map(a => ({guid: clean(a.guid), name: clean(a.name, 300), mime_type: clean(a.mime_type, 100), size: Math.max(0, Number(a.size) || 0), status: ['pending','protected','too_large','unavailable'].includes(a.status) ? a.status : 'pending'})).filter(a => a.guid);
const publicMessage = row => ({...row, text:row.retracted_at?'':row.text, attachments: row.retracted_at?[]:(row.attachments || []).map(({file_uri, ...a}) => a)});
const publicDevice = d => d && ({device_id:d.device_id, label:d.label, enabled:d.enabled, started_at:d.started_at, last_seen_at:d.last_seen_at, last_sync_at:d.last_sync_at, source_ok:d.source_ok, pending_count:d.pending_count, last_error:d.last_error});
const all = async entity => {const rows=[];for(let skip=0;skip<50000;skip+=500){const page=await entity.list('-created_date',500,skip);rows.push(...page);if(page.length<500)return rows;}throw Error('Too many records.');};
export function createMessagesBridgeHandler({getClient, fetchFile = fetch, now = () => new Date()} = {}) {
 return async req => {
  if (req.method !== 'POST') return response({error:'Use POST.'},405);
  try {
   const client = await getClient(req), api = client.asServiceRole.entities;
   const key = req.headers.get('x-glass-forge-key');
   let device = null;
   if (key) {
    if (key.length < 40 || key.length > 200) return response({error:'Device authorization required.'},401);
    device = (await api.MessageBridgeDevice.filter({token_hash:await hash(key), enabled:true},'-created_date',1))[0];
    if (!device) return response({error:'Device authorization required.'},401);
   } else if (!isOwner(await client.auth.me().catch(() => null))) return response({error:'Owner access required.'},403);
   const raw = await req.text();
   if (raw.length > 12000000) return response({error:'Request is too large.'},413);
   const input = JSON.parse(raw), action = input.action, at = now().toISOString();
   if (device && !['heartbeat','ingest','upload'].includes(action)) return response({error:'This device can only deliver messages and connection health.'},403);
   if (!device && ['heartbeat','ingest','upload'].includes(action)) return response({error:'Paired device required.'},403);
   if (action === 'heartbeat') {
    await api.MessageBridgeDevice.update(device.id,{last_seen_at:at, source_ok:input.source_ok===true, pending_count:Math.max(0,Math.floor(Number(input.pending_count)||0)), last_sync_at:date(input.last_sync_at)||device.last_sync_at||'',last_error:clean(input.last_error,200)});
    return response({ok:true,checked_at:at});
   }
   if (action === 'ingest') {
    const m = input.message || {}, guid=clean(m.source_guid), chat=clean(m.source_chat_guid,500), sent=date(m.sent_at);
    if (!guid || !chat || !sent || !['incoming','outgoing'].includes(m.direction)) return response({error:'Message identity, conversation, date and direction are required.'},400);
    if (device.started_at && sent < device.started_at) return response({error:'Message predates this connection.'},400);
    const sourceKey=await hash(device.device_id+':'+guid), conversationKey=await hash(device.device_id+':'+chat);
    const prior=(await api.MessageRecord.filter({source_key:sourceKey},'-created_date',1))[0];
    const existingAttachments=new Map((prior?.attachments||[]).map(a=>[a.guid,a]));
    const attachments=safeAttachments(m.attachments).map(a=>({...a,...(existingAttachments.get(a.guid)?.file_uri ? existingAttachments.get(a.guid) : {})}));
    const row={source_key:sourceKey,device_id:device.device_id,source_guid:guid,conversation_key:conversationKey,text:clean(m.text,50000),sent_at:sent,direction:m.direction,sender:clean(m.sender,300),reply_guid:clean(m.reply_guid),edited_at:date(m.edited_at),retracted_at:date(m.retracted_at),attachments};
    const saved=prior?await api.MessageRecord.update(prior.id,row):await api.MessageRecord.create(row);
    // Retried delivery repairs either half of a partially completed save. Job links are never overwritten.
    const previous=(await api.MessageConversation.filter({conversation_key:conversationKey},'-created_date',1))[0];
    const conversation={conversation_key:conversationKey,device_id:device.device_id,source_chat_guid:chat,title:clean(m.conversation_title,300)||clean(m.sender,300)||'Messages',participants:(Array.isArray(m.participants)?m.participants:[]).slice(0,100).map(p=>clean(p,300))};
    if (!previous || sent >= (previous.last_message_at||'')) Object.assign(conversation,{last_message_at:sent,last_text:row.retracted_at?'Message was unsent':row.text.slice(0,180)||(attachments.length?'Attachment':'Message')});
    if (previous) await api.MessageConversation.update(previous.id,conversation); else await api.MessageConversation.create(conversation);
    return response({ok:true,source_key:sourceKey,conversation_key:conversationKey,message_id:saved.id,duplicate:Boolean(prior)});
   }
   if (action === 'upload') {
    const sourceKey=await hash(device.device_id+':'+clean(input.source_guid));
    const row=(await api.MessageRecord.filter({source_key:sourceKey,device_id:device.device_id},'-created_date',1))[0];
    const attachment=row?.attachments?.find(a=>a.guid===input.attachment_guid);
    if (!attachment) return response({error:'Message attachment was not registered.'},404);
    if (attachment.file_uri) return response({ok:true,duplicate:true});
    if (['protected','too_large','unavailable'].includes(input.status)) {
     await api.MessageRecord.update(row.id,{attachments:row.attachments.map(a=>a.guid===attachment.guid?{...a,status:input.status}:a)});
     return response({ok:true});
    }
    if (typeof input.base64!=='string' || input.base64.length>11200000) return response({error:'Attachment exceeds the 8 MB transfer limit.'},413);
    const bytes=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));
    if (!bytes.length || bytes.length>8388608) return response({error:'Invalid attachment size.'},400);
    const {file_uri}=await client.asServiceRole.integrations.Core.UploadPrivateFile({file:new File([bytes],attachment.name||'attachment',{type:attachment.mime_type||'application/octet-stream'})});
    if (!file_uri) throw Error('Private upload did not return a file reference.');
    await api.MessageRecord.update(row.id,{attachments:row.attachments.map(a=>a.guid===attachment.guid?{...a,file_uri,status:'ready'}:a)});
    return response({ok:true});
   }
   if (action === 'inbox') {
    const query={};
    if (input.job_id) query.job_id=clean(input.job_id);
    if(Array.isArray(input.contact_participants))query.participants={$in:input.contact_participants.filter(v=>typeof v==='string'&&v.length<=300).slice(0,10)};
    const q=clean(input.search,120).trim();
    if(q){const pattern=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');query.$or=['title','last_text','job_name','participants'].map(k=>({[k]:{$regex:pattern,$options:'i'}}));}
    const skip=Math.max(0,Math.min(100000,Math.floor(Number(input.skip)||0)));
    const [rows,devices]=await Promise.all([api.MessageConversation.filter(query,'-last_message_at',101,skip),api.MessageBridgeDevice.list('-created_date',20)]);
    return response({conversations:rows.slice(0,100),has_more:rows.length>100,devices:devices.map(publicDevice),checked_at:at});
   }
   if (action === 'conversation') {
    const key=clean(input.conversation_key),skip=Math.max(0,Math.floor(Number(input.skip)||0));
    const conversation=(await api.MessageConversation.filter({conversation_key:key},'-created_date',1))[0];
    if(!conversation)return response({error:'Conversation not found.'},404);
    const rows=await api.MessageRecord.filter({conversation_key:key},'-sent_at',101,skip);
    return response({conversation,messages:rows.slice(0,100).map(publicMessage),has_more:rows.length>100});
   }
   if (action === 'job_threads') {
    const jobId=clean(input.job_id);
    const job=jobId?await api.Jobs.get(jobId).catch(()=>null):null;
    if(!job)return response({error:'Job not found.'},404);
    const [conversations,links,snapshots]=await Promise.all([all(api.MessageConversation),all(api.ContactJobLink),api.ContactDirectorySnapshot.list('-created_date',1)]);
    let contacts=[];
    const snapshot=snapshots[0];
    if(snapshot?.directory_data?.contacts)contacts=snapshot.directory_data.contacts;
    else if(snapshot?.data_file_uri){
     const signed=await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:snapshot.data_file_uri,expires_in:120});
     const file=await fetchFile(signed.signed_url);if(file.ok)contacts=(await file.json())?.contacts||[];
    }
    const resolved=resolveJobMessageThreads({jobId,conversations,contacts,links});
    const threads=[];
    for(const item of resolved.threads.sort((a,b)=>String(b.conversation.last_message_at||'').localeCompare(String(a.conversation.last_message_at||''))).slice(0,50)){
     const messages=await api.MessageRecord.filter({conversation_key:item.conversation.conversation_key},'-sent_at',6);
     threads.push({conversation:item.conversation,provenance:item.provenance,messages:messages.slice(0,5).map(publicMessage)});
    }
    return response({job:{id:job.id,name:job.canonical_name},threads,review_count:resolved.review.length});
   }
   if (action === 'jobs') {
    const q=clean(input.search,120).trim();
    const pattern=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const query=q?{$or:['canonical_name','id','aliases','po_numbers','oe_numbers'].map(field=>({[field]:{$regex:pattern,$options:'i'}}))}:{};
    return response({jobs:(await api.Jobs.filter(query,'canonical_name',50)).map(j=>({id:j.id,name:j.canonical_name,address:j.address,po_numbers:j.po_numbers||[],oe_numbers:j.oe_numbers||[]}))});
   }
   if (action === 'link_job' || action === 'mark_read') {
    const row=(await api.MessageConversation.filter({conversation_key:clean(input.conversation_key)},'-created_date',1))[0];
    if(!row)return response({error:'Conversation not found.'},404);
    let update={last_read_at:at};
    if(action==='link_job'){
     const job=input.job_id?await api.Jobs.get(clean(input.job_id)):null;
     if(input.job_id&&!job)return response({error:'Select an existing job.'},400);
     update={job_id:job?.id||'',job_name:job?.canonical_name||''};
    }
    return response({conversation:await api.MessageConversation.update(row.id,update)});
   }
   if(action==='attachment'){
    const row=await api.MessageRecord.get(clean(input.message_id));
    const attachment=row?.attachments?.find(a=>a.guid===input.attachment_guid);
    if(row?.retracted_at||!attachment?.file_uri)return response({error:'This attachment is not available in Glass Forge yet.'},404);
    return response(await readPrivateMessageAttachment(client,attachment,fetchFile));
   }
   if(action==='set_device'){
    const device=(await api.MessageBridgeDevice.filter({device_id:clean(input.device_id)},'-created_date',1))[0];
    if(!device)return response({error:'Connection not found.'},404);
    return response({device:publicDevice(await api.MessageBridgeDevice.update(device.id,{enabled:input.enabled===true}))});
   }
   if (action === 'purge_message') {
    const id=clean(input.message_id,100);
    if(!id)return response({error:'Message id is required.'},400);
    const row=await api.MessageRecord.get(id).catch(()=>null);
    if(!row)return response({error:'Message not found.'},404);
    const convKey=row.conversation_key;
    await api.MessageRecord.delete(id);
    const conv=(await api.MessageConversation.filter({conversation_key:convKey},'-created_date',1))[0];
    let conversation_updated=false;
    if(conv){
     const rest=await api.MessageRecord.filter({conversation_key:convKey},'-sent_at',1);
     const latest=rest[0];
     const patch=latest?{last_message_at:latest.sent_at,last_text:latest.retracted_at?'Message was unsent':(latest.text||'').slice(0,180)||((latest.attachments||[]).length?'Attachment':'Message')}:{last_message_at:'',last_text:'Message deleted'};
     await api.MessageConversation.update(conv.id,patch);
     conversation_updated=true;
    }
    return response({ok:true,deleted:id,conversation_updated,checked_at:at});
   }
   return response({error:'Unsupported action.'},400);
  } catch (error) {
   // Never return provider URLs, device keys, or private file references in errors.
   console.error('Messages bridge request failed', error?.name || 'Error');
   return response({error:'Messages request could not be completed. Please retry.'},500);
  }
 };
}
Deno.serve(createMessagesBridgeHandler({getClient:createClientFromRequest}));

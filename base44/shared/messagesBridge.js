// Private, owner-only inbox. Incoming content is data, never executable instructions.
const owners = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const isOwner = u => u?.role === 'admin' && owners.has(String(u.email || '').trim().toLowerCase());
const clean = (s, max = 200) => typeof s === 'string' ? s.slice(0, max) : '';
const date = s => Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : '';
const response = (data, status = 200) => Response.json(data, {status});
const hash = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');
const safeAttachments = list => (Array.isArray(list) ? list : []).slice(0, 50).map(a => ({guid: clean(a.guid), name: clean(a.name, 300), mime_type: clean(a.mime_type, 100), size: Math.max(0, Number(a.size) || 0), status: ['pending','protected','too_large','unavailable'].includes(a.status) ? a.status : 'pending'})).filter(a => a.guid);
const publicMessage = row => ({...row, attachments: (row.attachments || []).map(({file_uri, ...a}) => a)});
const publicDevice = d => d && ({device_id:d.device_id, label:d.label, enabled:d.enabled, started_at:d.started_at, last_seen_at:d.last_seen_at, last_sync_at:d.last_sync_at, source_ok:d.source_ok, pending_count:d.pending_count, last_error:d.last_error});
export function createMessagesBridgeHandler({getClient, now = () => new Date()} = {}) {
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
   if (action === 'jobs') {
    const q=clean(input.search,120).trim();
    const query=q?{canonical_name:{$regex:q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'}}:{};
    return response({jobs:(await api.Jobs.filter(query,'canonical_name',50)).map(j=>({id:j.id,name:j.canonical_name,address:j.address}))});
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
    if(!attachment?.file_uri)return response({error:'This attachment is not available in Glass Forge yet.'},404);
    const {signed_url}=await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:attachment.file_uri,expires_in:300});
    return response({url:signed_url});
   }
   if(action==='set_device'){
    const device=(await api.MessageBridgeDevice.filter({device_id:clean(input.device_id)},'-created_date',1))[0];
    if(!device)return response({error:'Connection not found.'},404);
    return response({device:publicDevice(await api.MessageBridgeDevice.update(device.id,{enabled:input.enabled===true}))});
   }
   return response({error:'Unsupported action.'},400);
  } catch (error) {
   // Never return provider URLs, device keys, or private file references in errors.
   console.error('Messages bridge request failed', error?.name || 'Error');
   return response({error:'Messages request could not be completed. Please retry.'},500);
  }
 };
}

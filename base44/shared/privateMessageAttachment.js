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

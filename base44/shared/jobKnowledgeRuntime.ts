import * as XLSX from 'npm:xlsx@0.18.5';
import { parseTracker } from '../functions/lookup-job-knowledge/parser.js';
let trackerCache={key:'',rows:[]};
export async function readKnowledgeTracker(tracker,api) {
  const key=tracker.id+':'+tracker.sha256;
  if(trackerCache.key===key)return trackerCache.rows;
  const signed=await api.integrations.Core.CreateFileSignedUrl({file_uri:tracker.file_uri,expires_in:300});
  const response=await fetch(signed.signed_url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok||Number(response.headers.get('content-length'))>30*1048576)throw Error('Tracker read failed');
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>30*1048576){await reader.cancel();throw Error('Tracker too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(sha!==tracker.sha256)throw Error('Tracker integrity mismatch');
  trackerCache={key,rows:parseTracker(XLSX,bytes).rows};return trackerCache.rows;
}

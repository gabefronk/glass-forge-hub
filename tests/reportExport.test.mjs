import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchReportFile,buildReportPdf} from '../src/components/reports/reportExport.js';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function downloads(run){const original=globalThis.fetch;globalThis.fetch=async url=>new Response(new Uint8Array(url==='https://file.test/1'?[1,2,3]:[4,5]));try{await run();}finally{globalThis.fetch=original;}}
test('native downloads verify and reassemble the ordered original bytes',async()=>downloads(async()=>{
 const a=new Uint8Array([1,2,3]),b=new Uint8Array([4,5]);const blob=await fetchReportFile({mime_type:'video/mp4',size:5,chunks:[{url:'https://file.test/1',offset:0,size:3,sha256:await digest(a)},{url:'https://file.test/2',offset:3,size:2,sha256:await digest(b)}]});
 assert.equal(blob.type,'video/mp4');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),new Uint8Array([1,2,3,4,5]));
}));
test('native downloads reject corrupted pieces and incomplete manifests',async()=>downloads(async()=>{
 await assert.rejects(()=>fetchReportFile({url:'https://file.test/1',size:3,sha256:'incorrect'}),/failed verification/);
 await assert.rejects(()=>fetchReportFile({size:5,chunks:[{url:'https://file.test/1',offset:1,size:3}]}),/incomplete/);
 await assert.rejects(()=>fetchReportFile({size:5,chunks:[{url:'https://file.test/1',offset:0,size:3}]}),/does not match/);
}));
test('historical reports retain unknown timestamps without displaying an invalid date',async()=>{
 const pdf=await buildReportPdf({title:'Saved historical report',report_date:'2026-09-12',source_checked_at:'2026-09-12T20:00:00Z',posts:[{source:'library',project_name:'Builder Lot 1',created_at:'',message:'Original note',attachments:[]}]},()=>{throw Error('No attachment lookup expected');});
 const body=new TextDecoder().decode(await pdf.arrayBuffer());assert.match(body,/Date not recorded/);assert.doesNotMatch(body,/Invalid Date/);
});

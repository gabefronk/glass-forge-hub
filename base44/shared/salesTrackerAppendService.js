import { parseTracker, normalize } from '../functions/salesTrackerImport/parser.js';
import { TRACKER_HEADERS, planTrackerAppend, trackerViewSignature } from './salesTrackerAppend.js';
import { readTrackerView, trackerSha } from './salesTrackerView.js';

export function parseTrackerDelta(XLSX, bytes, filename) {
  const lib=XLSX.default||XLSX;
  const workbook=/\.xlsx$/i.test(filename) ? lib.read(bytes,{type:'array',cellDates:false}) : lib.read(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{type:'string',raw:true});
  const sheet=workbook.Sheets['DAILY SALES'] || (workbook.SheetNames.length===1 ? workbook.Sheets[workbook.SheetNames[0]] : null);
  if(!sheet) throw Error('The delta must contain a DAILY SALES worksheet.');
  const range=lib.utils.decode_range(sheet['!ref']||'A1');
  if(range.e.r>5000 || range.e.c>100) throw Error('Use a delta of at most 5,000 rows and the 12 Daily Sales columns.');
  for(let c=0;c<12;c++) if(normalize(sheet[lib.utils.encode_cell({r:0,c})]?.v)!==normalize(TRACKER_HEADERS[c])) throw Error('Use the Daily Sales headers through Order Folder URL, in their original order.');
  for(let r=0;r<=range.e.r;r++) for(let c=12;c<=range.e.c;c++) if(String(sheet[lib.utils.encode_cell({r,c})]?.v??'').trim()) throw Error('Extra populated columns need review; no columns will be silently dropped.');
  for(let r=1;r<=range.e.r;r++) for(let c=0;c<12;c++) if(sheet[lib.utils.encode_cell({r,c})]?.f) throw Error('The delta must contain captured cell values, not formulas.');
  const delta=lib.utils.book_new();lib.utils.book_append_sheet(delta,sheet,'DAILY SALES');
  if(workbook.Workbook?.WBProps?.date1904) delta.Workbook={WBProps:{date1904:true}};
  return parseTracker(lib,lib.write(delta,{type:'array',bookType:'xlsx'})).rows;
}
const reportOnly = plan => ({input_count:plan.decisions.length,inserted:plan.inserted,skipped:plan.skipped,conflicting:plan.conflicting,decisions:plan.decisions});
const replay = prior => ({...prior.report,inserted:0,skipped:prior.report.inserted+prior.report.skipped,
  decisions:prior.report.decisions.map(row=>row.action==='inserted'?{...row,action:'skipped',reason:'This row was already imported.'}:row),unchanged:true,id:prior.id,status:'committed'});
export function createTrackerAppendHandler({getClient,XLSX,readView=readTrackerView,now=()=>new Date()}) {
 return async req=>{
  if(req.method!=='POST') return Response.json({error:'Use POST.'},{status:405});
  const client=await getClient(req), user=await client.auth.me().catch(()=>null);
  if(user?.role!=='admin') return Response.json({error:'Administrator access required.'},{status:403});
  try {
   const body=await req.json();
   if(!['review','append'].includes(body.action)) throw Error('Choose review or append. Replacement is not supported by this importer.');
   if(typeof body.filename!=='string' || body.filename.length>250 || !/\.(xlsx|csv|tsv)$/i.test(body.filename)) throw Error('Choose an XLSX, CSV or TSV Daily Sales delta.');
   if(typeof body.file_base64!=='string' || body.file_base64.length>7000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.file_base64)) throw Error('Choose a file up to 5 MB.');
   const bytes=Uint8Array.from(atob(body.file_base64),c=>c.charCodeAt(0));
   if(!bytes.length || bytes.length>5000000) throw Error('Choose a file up to 5 MB.');
   const captured=new Date(body.source_captured_at);
   if(!Number.isFinite(captured.getTime()) || captured.getTime()>now().getTime()+300000) throw Error('Enter a valid source capture time.');
   const incoming=parseTrackerDelta(XLSX,bytes,body.filename), fileSha=await trackerSha(bytes), importKey='daily-sales-append-v1:'+fileSha;
   const entity=client.asServiceRole.entities.SalesTrackerAppendBatch;
   const prior=(await entity.filter({status:'committed',import_key:importKey},'imported_at',1))[0];
   if(prior) return Response.json(replay(prior));
   const current=await readView(client,XLSX), plan=planTrackerAppend(current.rows,incoming), report=reportOnly(plan);
   const reviewToken=await trackerSha(new TextEncoder().encode(JSON.stringify([current.snapshot.id,current.snapshot.sha256,trackerViewSignature(current.rows),fileSha,captured.toISOString(),user.email])));
   if(body.action==='review') return Response.json({...report,status:'review',review_token:reviewToken,base_snapshot_id:current.snapshot.id,base_row_count:current.rows.length});
   if(body.review_token!==reviewToken) return Response.json({error:'The tracker or uploaded file changed. Review the delta again before appending.'},{status:409});
   if(!plan.inserted) return Response.json({...report,status:'committed',unchanged:true});
   const {file_uri}=await client.integrations.Core.UploadPrivateFile({file:new File([bytes],body.filename,{type:/\.xlsx$/i.test(body.filename)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/plain'})});
   if(!file_uri) throw Error('The private delta upload did not finish.');
   // One immutable append batch. No existing snapshot, row, invoice or calendar
   // record is updated or deleted. Read-time set semantics preserve retries.
   const saved=await entity.create({status:'committed',import_key:importKey,base_snapshot_id:current.snapshot.id,base_sha256:current.snapshot.sha256,
     filename:body.filename,file_sha256:fileSha,file_uri,source_captured_at:captured.toISOString(),imported_at:now().toISOString(),imported_by:user.email,
     rows:plan.rows,report});
   return Response.json({...report,status:'committed',id:saved.id,base_row_count:current.rows.length,total_row_count:current.rows.length+plan.inserted});
  } catch(error) {return Response.json({error:error.message||'Append did not finish. Existing snapshot data remains intact.'},{status:400});}
 };
}

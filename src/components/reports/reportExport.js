import { jsPDF } from 'jspdf';

export const reportFileName = report => (report.title || 'Field report').replace(/[^a-z0-9 _.-]/gi, '').trim().slice(0,100) + ' ' + report.report_date + '.pdf';
const when = s => new Date(s).toLocaleString('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'});
export async function fetchReportFile(file){
 const sources=file.chunks?.length?file.chunks:[{url:file.url,size:file.size,sha256:file.sha256,offset:0}],parts=[];let offset=0;
 for(const source of sources){
  if(source.offset!==undefined&&source.offset!==offset)throw Error('File pieces are incomplete. Retry before sharing.');
  const response=await fetch(source.url);if(!response.ok)throw Error('A saved file could not be downloaded. Retry before sharing.');
  const bytes=await response.arrayBuffer();if(source.size&&bytes.byteLength!==source.size)throw Error('A saved file transfer was incomplete.');
  if(source.sha256){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==source.sha256)throw Error('A saved file failed verification.');}
  parts.push(bytes);offset+=bytes.byteLength;
 }
 if(file.size&&offset!==file.size)throw Error('The saved file size does not match its source.');
 return new Blob(parts,{type:file.mime_type||'application/octet-stream'});
}
async function imageData(url,metadata={}) {
 let blob=await fetchReportFile({...metadata,url});
 if(/image\/hei[cf]/i.test(blob.type)||/\.hei[cf]$/i.test(metadata.name||'')){
  const {heicTo}=await import('heic-to/csp');
  blob=await heicTo({blob,type:'image/jpeg',quality:.9});
 }
 const objectUrl=URL.createObjectURL(blob);
 try{
  const img=new Image();img.src=objectUrl;await img.decode();
  const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  return {data:canvas.toDataURL('image/jpeg',.82),width:canvas.width,height:canvas.height};
 }finally{URL.revokeObjectURL(objectUrl);}
}
export async function buildReportPdf(report,call,onProgress=()=>{}) {
 const doc=new jsPDF({unit:'pt',format:'letter'}),margin=42,width=528,bottom=744;
 let y=0;
 const header=()=>{doc.setFillColor('#172438');doc.rect(0,0,612,72,'F');doc.setTextColor('#FFFFFF');doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('GLASS FORGE  /  FIELD REPORT',margin,42);doc.setTextColor('#172438');y=102;};
 const newPage=()=>{doc.addPage();header();};header();
 const text=(value,size=11,bold=false)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(String(value||''),width);for(const line of lines){if(y+size*1.4>bottom)newPage();doc.text(line,margin,y);y+=size*1.4;}y+=8;};
 text(report.title,22,true);text(report.report_date+'  ·  Mountain time',10);
 if(report.job_name)text('Job: '+report.job_name,11,true);
 if(report.notes){text('Report notes',13,true);text(report.notes);}
 const sources=[...(report.posts||[]),...(report.messages||[])];
 const photos=[];
 for(const s of sources){
  text(s.source==='messages'?'Text message · '+(s.sender||'Contact'):s.project_name,13,true);
  text(when(s.created_at),9);text(s.message||'Photo update; no written notes in source.');
  for(const a of s.attachments||[]){
   if(s.source==='messages'){
    if(a.status==='ready'&&a.mime_type?.startsWith('image/'))photos.push({caption:(s.sender||'Text message')+' · '+when(s.created_at),payload:{action:'message_photo',message_id:s.id,attachment_guid:a.guid}});
    else if(a.mime_type?.startsWith('image/'))throw Error('A selected text photo has not finished syncing. Wait for Messages to show it as ready.');
    else text('Additional attachment: '+(a.name||'File')+' (available in Messages)',9);
   }else if(a.type==='photo')photos.push({caption:s.project_name+' · '+when(s.created_at),payload:s.source==='library'?{action:'library_file',source_key:a.source_key}:{action:'photo',project_id:s.project_id,post_id:s.post_id,attachment_id:a.id,generation:a.generation}});
   else text('Additional attachment: '+(a.name||a.document_name||'File')+' (available in the report library or source)',9);
  }
 }
 if(photos.length>60)throw Error('This report contains more than 60 photos. Split it into smaller reports for easier sharing.');
 text(`${photos.length} photo${photos.length===1?'':'s'} included. Source checked ${when(report.source_checked_at||new Date().toISOString())}.`,9);
 for(let i=0;i<photos.length;i++){
  onProgress(`Preparing photo ${i+1} of ${photos.length}…`);
  if(i%2===0)newPage();
  const source=photos[i],file=await call(source.payload),img=await imageData(file.url,file);
  const top=i%2===0?100:423,maxHeight=270,scale=Math.min(width/img.width,maxHeight/img.height),w=img.width*scale,h=img.height*scale;
  doc.addImage(img.data,'JPEG',margin+(width-w)/2,top,w,h,undefined,'FAST');
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor('#475569');
  const caption=doc.splitTextToSize(`${i+1}. ${source.caption}`,width);doc.text(caption,margin,top+maxHeight+16);doc.setTextColor('#172438');
 }
 const count=doc.getNumberOfPages();for(let p=1;p<=count;p++){doc.setPage(p);doc.setFontSize(8);doc.setTextColor('#64748B');doc.text(`Glass Forge · ${report.report_date}`,margin,774);doc.text(`${p} / ${count}`,570,774,{align:'right'});}
 return new File([doc.output('blob')],reportFileName(report),{type:'application/pdf'});
}
export function downloadFile(file) {
 const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export async function buildEmailDraft(report,file) {
 const recipient=String(report.recipient||'').replace(/[\r\n]/g,''),subject=String(report.title||'Field report').replace(/[\r\n]/g,'');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const content=btoa(binary).match(/.{1,76}/g).join('\r\n'),boundary='gf-'+crypto.randomUUID();
 const email=['X-Unsent: 1','MIME-Version: 1','To: '+recipient,'Subject: '+subject,`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','',`Please see the attached field report for ${report.report_date}.`,``,`--${boundary}`,'Content-Type: application/pdf',`Content-Disposition: attachment; filename="${file.name.replace(/["\r\n]/g,'')}"`,'Content-Transfer-Encoding: base64','',content,`--${boundary}--`,''].join('\r\n');
 return new File([email],file.name.replace(/\.pdf$/,'.eml'),{type:'message/rfc822'});
}

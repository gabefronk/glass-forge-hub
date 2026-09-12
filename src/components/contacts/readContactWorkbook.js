import * as XLSX from 'xlsx';
const clean=v=>String(v??'').trim();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const phoneKey=v=>{const d=v.replace(/\D/g,'');return d.length===10?'+1'+d:d.length===11&&d[0]==='1'?'+'+d:'';};
export async function readContactWorkbook(file){
 if(file.size>12000000)throw Error('Choose a workbook under 12 MB.');
 const bytes=await file.arrayBuffer();
 if(file.name.toLowerCase().endsWith('.json'))return JSON.parse(new TextDecoder().decode(bytes));
 if(new Uint8Array(bytes)[0]!==80)throw Error('This copy cannot be read here. Open it in Excel on your approved device, then use Save a Copy.');
 const wb=XLSX.read(bytes,{type:'array'}),contactSheet=wb.Sheets.CONTACTS,jobSheet=wb.Sheets['DAILY SALES'];
 if(!contactSheet||!jobSheet)throw Error('The workbook needs CONTACTS and DAILY SALES sheets.');
 const rows=XLSX.utils.sheet_to_json(contactSheet,{header:1,raw:false,defval:'',blankrows:true});
 if(!['First Name','Last Name','Name First and Last','Builder','Phone#','Email'].every((h,i)=>clean(rows[0]?.[i])===h))throw Error('The CONTACTS columns do not match your service-ticket workbook.');
 const contacts=[];
 for(let i=1;i<rows.length;i++){
  const a=rows[i].map(clean);if(!a.some(Boolean))continue;
  const name=a[2]||a.slice(0,2).filter(Boolean).join(' '),company=a[3]||'',phone=a[4]||'',email=a[5]||'';
  const review=company.startsWith('Retrieving data.')?'Builder cell contains an Excel retrieval error.':'';
  const builder=review?'':company.split(/\s+-\s*|\s*-\s+/)[0].trim();
  const key=await digest(new TextEncoder().encode([name.toLowerCase(),phoneKey(phone),email.toLowerCase(),company.toLowerCase()].join('|')));
  contacts.push({key,row:i+1,first_name:a[0]||'',last_name:a[1]||'',name,company,builder,phone,phone_key:phoneKey(phone),email,email_key:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email.toLowerCase():'',note:a[6]||'',review_note:review||(!phone&&!email?'No phone number or email in source.':'')});
 }
 const sales=XLSX.utils.sheet_to_json(jobSheet,{header:1,raw:false,defval:'',blankrows:true}),header=sales[0].map(clean);
 const idx=h=>header.indexOf(h),bi=idx('Builder'),si=idx('Subdivision'),li=idx('LOT #')>=0?idx('LOT #'):idx('Lot Number'),oi=idx('OE'),pi=idx('PO')>=0?idx('PO'):idx('CUSTOMER');
 if([bi,si,li,oi,pi].some(i=>i<0))throw Error('The DAILY SALES job columns could not be identified.');
 const job_references=sales.slice(1).flatMap((a,i)=>clean(a[bi])?[{row:i+2,po:clean(a[pi]),oe:clean(a[oi]),builder:clean(a[bi]),subdivision:clean(a[si]),lot:clean(a[li])}]:[]);
 return {version:1,source:{filename:file.name,workbook_sha256:await digest(bytes),captured_at:new Date().toISOString(),location:'Imported Excel copy',contact_sheet:'CONTACTS',job_sheet:'DAILY SALES'},contacts,job_references};
}

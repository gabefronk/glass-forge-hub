export function normalize(value) { return String(value ?? "").trim().replace(/\s+/g," ").toLowerCase(); }
export function parseTracker(XLSX, bytes) {
 XLSX = XLSX.default || XLSX;
 const workbook = XLSX.read(bytes, {type:"array", cellDates:false});
 const sheet = workbook.Sheets["DAILY SALES"];
 if (!sheet) throw Error("Missing DAILY SALES worksheet.");
 const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
 if(range.e.r > 50000 || range.e.c > 300) throw Error("Workbook exceeds supported size.");
 const headers = ["Month PD","CLOSED","DATE","PO","OE","Builder","Subdivision","LOT #","Delivery/Arrival date","Total Sale Price","Notes","Order Folder URL"];
 const cell = (r,c) => sheet[XLSX.utils.encode_cell({r,c})];
 const val = (r,c) => cell(r,c)?.v ?? "";
 for(let c=0;c<headers.length;c++) if(normalize(val(0,c))!==normalize(headers[c])) throw Error("Unexpected DAILY SALES header in column "+XLSX.utils.encode_col(c));
 const text=(r,c)=>String(val(r,c)).trim();
 const date=(r,c)=>{
  const v=val(r,c);
  if(v==="") return "";
  if(typeof v === "number") {
   const d=XLSX.SSF.parse_date_code(v,{date1904:!!workbook.Workbook?.WBProps?.date1904});
   if(d && d.y>=1900 && d.y<=2200) return [d.y,String(d.m).padStart(2,"0"),String(d.d).padStart(2,"0")].join("-");
  }
  return text(r,c);
 };
 const rows=[];
 for(let r=1;r<=range.e.r;r++){
  if(!text(r,5) && !text(r,6) && !text(r,4) && !text(r,3)) continue;
  rows.push({source_sheet:"DAILY SALES",source_row:r+1,date_cell:"I"+(r+1),
   month_paid:text(r,0),closed:text(r,1),order_date:date(r,2),po:text(r,3),oe:text(r,4),
   builder:text(r,5),subdivision:text(r,6),lot:text(r,7),arrival_date:date(r,8),
   sale_price:val(r,9),notes:text(r,10),order_folder_url:text(r,11)});
 }
 if(!rows.length) throw Error("No sales rows found.");
 return {rows,sheet_names:workbook.SheetNames};
}
export function matchRows(rows, query) {
 const keys=["builder","subdivision","lot","oe","po"];
 const supplied=keys.filter(k=>normalize(query[k]));
 if(!supplied.length) return [];
 return rows.filter(row=>supplied.every(k=>normalize(row[k])===normalize(query[k])));
}

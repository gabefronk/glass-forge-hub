import { ImportError, validateImportedSnapshot } from "./amscoQuoteImportModel.js";
const fail = message => { throw new ImportError(400,message); };
const array = v => v == null || v === "" ? [] : Array.isArray(v) ? v : [v];
const value = v => String(v && typeof v === "object" ? v["@_value"] ?? v["#text"] ?? "" : v ?? "").trim();
const get = (node,key) => value(node?.[key.toLowerCase()]);
const round = n => Math.round((n+Number.EPSILON)*100)/100;
const numeric = (node,key,optional=false) => {
  const text=get(node,key);
  if (!text && optional) return 0;
  if (!/^-?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) fail("The export is missing a valid " + key + ".");
  return Number(text);
};
const privateKey = /token|password|secret|cookie|authorization|__proto__|prototype|constructor/i;
function walk(node,callback,depth=0) {
  if (depth>100) fail("The XML nesting is too deep.");
  if (!node || typeof node!=="object") return;
  for (const [key,entry] of Object.entries(node)) {
    if (privateKey.test(key) || key.startsWith("@_")) continue;
    for (const item of array(entry)) { callback(key,item); walk(item,callback,depth+1); }
  }
}
export function createAmscoXmlParser({XMLParser,unzipSync}) {
  const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:true,
    transformTagName:name=>name.toLowerCase(),transformAttributeName:name=>name.toLowerCase()});
  function xml(text,limit=12000000) {
    if (typeof text!=="string" || text.length>limit || !text.trim() || /<!DOCTYPE|<!ENTITY/i.test(text)) fail("Choose an AMSCO Default Quote XML export without document entities.");
    try {return parser.parse(text,true);} catch {fail("The AMSCO XML export is not well formed.");}
  }
  const embedded = (node,key) => get(node,key) ? xml(get(node,key)) : {};
  const cleanNotes = text => !text || /^-1$/.test(text) ? "" : text;
  function noteText(node) {
    const text=value(node);
    if(!text)return "";
    if(!text.startsWith("<"))return text;
    const notes=[];
    walk(xml(text),(key,item)=>{if(/^note\d*$|^text$|^notetext$/.test(key)&&value(item))notes.push(value(item));});
    return [...new Set(notes)].join("\n\n");
  }
  function drawing(master,width,height) {
    const packed=get(master,"serializeddrawingprimesnative");
    if(!packed||!unzipSync||!width||!height)return null;
    try {
      if(packed.length>300000||!/^[A-Za-z0-9+/=\s]+$/.test(packed))return null;
      const bytes=Uint8Array.from(atob(packed.replace(/\s/g,"")),c=>c.charCodeAt(0));
      const unzipped=unzipSync(bytes,{filter:entry=>{
        if(entry.originalSize>1000000)throw Error("Drawing exceeds size limit");
        return entry.name==="1";
      }});
      if(!unzipped["1"]||unzipped["1"].length>1000000)return null;
      const tree=xml(new TextDecoder().decode(unzipped["1"]),1000000);
      const paths=[];
      function point(n,x,y){const a=numeric(n,x),b=numeric(n,y);if(Math.abs(a)>2000||Math.abs(b)>2000)throw Error();return [a,b];}
      walk(tree,(key,layer)=>{
        if(key!=="layercontainer"||get(layer,"invisible")==="True")return;
        const name=get(layer,"slayername");
        // Dimension text is redrawn from the exported frame dimensions. Native geometry stays intact.
        if(/dimension/i.test(name))return;
        for(const region of array(layer?.oprimes?.drawregion)){
          const points=[];
          for(const item of array(region?.oal?.regionitem)){
            const segment=item?.oitem;
            if(segment?.regionline){points.push(point(segment.regionline,"x1","y1"),point(segment.regionline,"x2","y2"));}
            else if(segment?.regionarc){
              const a=segment.regionarc,cx=numeric(a,"xcenter"),cy=numeric(a,"ycenter"),radius=numeric(a,"radius"),start=numeric(a,"startangle"),end=numeric(a,"endangle");
              if(radius<0||radius>2000)throw Error();
              const steps=Math.max(2,Math.min(96,Math.ceil(Math.abs(end-start)/8)));
              for(let i=0;i<=steps;i++){const angle=(start+(end-start)*i/steps)*Math.PI/180;points.push([cx+radius*Math.cos(angle),cy+radius*Math.sin(angle)]);}
            } else throw Error("Unsupported drawing segment");
          }
          if(points.length)paths.push({points,closed:true,layer:/daylight/i.test(name)?"glass":/grille/i.test(name)?"grille":/operation/i.test(name)?"operation":"frame",fill:get(region,"cfill")});
        }
        for(const line of array(layer?.oprimes?.drawline))paths.push({points:[point(line,"p1x","p1y"),point(line,"p2x","p2y")],closed:false,layer:/operation/i.test(name)?"operation":"frame",fill:""});
      });
      if(paths.length>1500||paths.reduce((n,p)=>n+p.points.length,0)>20000)return null;
      return paths.length?{width,height,paths}:null;
    }catch{return null;}
  }
  function lineItem(item,number) {
    const extra=embedded(item?.extradata,"extrafields"),fields={};
    for(const field of array(extra?.clsnamevalues?.clsnamevalue)){
      const name=get(field,"name"),v=get(field,"value");
      if(name&&v&&!privateKey.test(name))fields[name]=v;
    }
    const description=get(item,"description")||fields.AmscoDescription||get(item?.extradata,"longdescription");
    if(!description)fail("Line "+number+" has no saved description.");
    const style=description.split(/\r?\n/)[0].replace(/^AMSCO\s+[\d.]+\s*x\s*[\d.]+\s*-\s*/i,"").trim();
    const width=numeric(item,"FrameWidth",true),height=numeric(item,"FrameHeight",true);
    const kind=/patio door|entry door|folding door|french door/i.test(style)?"door":/delivery|misc|labor|service|freight/i.test(style)?"service":width>0&&height>0?"window":"other";
    const qty=numeric(item,"quantity");
    const unit_prices={list:numeric(item,"CustomerListPrice"),dealer:numeric(item,"dealerprice"),customer:numeric(item,"customerprice")};
    const line_totals={list:round(unit_prices.list*qty),dealer:numeric(item,"dealerextendedprice"),customer:numeric(item,"customerextendedprice")};
    const notes=[get(item,"Comment"),noteText(item.linotes),get(item,"pknotes"),fields["Customer Line Item Notes"]].map(cleanNotes).filter(Boolean);
    const specifications=Object.entries(fields).filter(([k])=>/^Description_ShortDescription_/.test(k)).map(([key,v])=>({label:key.replace("Description_ShortDescription_","").replace(/^Wrapping - /,""),value:v.replace(/^~/,"").trim()})).filter(s=>s.value&&s.value!==",");
    return {native_line_id:get(item,"id"),native_line_number:number,kind,qty,room:get(item,"room"),style,description,
      notes:[...new Set(notes)].join("\n\n"),options:{},ratings:Object.fromEntries(["NFRC Description","AAMA Description","CPD"].filter(k=>fields[k]).map(k=>[k,fields[k]])),
      specifications,...(width>0&&height>0?{width,height}:{}),unit_prices,line_totals};
  }
  return function parseExport(text,expectedNumber) {
    const parsed=xml(text),root=parsed.quote;
    if(!root||Array.isArray(root)||!/amsco/i.test(get(root,"ApplicationName")))fail("This file is not an AMSCO Default Quote XML export.");
    const number=get(root,"userquotenumber");
    if(expectedNumber&&number!==expectedNumber)fail("The XML quote number does not match the number entered.");
    const masters=array(root.lineitemmasters?.lineitemmaster);
    if(masters.length<1||masters.length>300)fail("The export must contain 1–300 saved line items.");
    const warnings=[];
    const lines=masters.map(master=>{
      const number=get(master,"linenumber"),qty=numeric(master,"quantity");
      if(/true/i.test(get(master,"Deleted")))fail("The export contains a deleted line. Export the current quote again.");
      const items=array(master.lineitems?.lineitem);
      if(!items.length||items.length>100)fail("Line "+number+" is missing its saved components.");
      const components=items.map((item,index)=>{
        if(/true|^1$/i.test(get(item,"deleted"))||Number(get(item,"canceled")||0)!==0)fail("Line "+number+" contains a deleted or cancelled component.");
        return lineItem(item,number+"-"+(get(item,"linenumber")||index+1));
      });
      const first=components[0];
      const line={...first,native_line_id:get(master,"id"),native_line_number:number,qty,room:get(master,"room")||first.room,
        options:{},specifications:[...first.specifications]};
      if(components.length>1){
        line.components=components;
        line.description=components.map(c=>"Component "+c.native_line_number+" · Qty "+c.qty+"\n"+c.description).join("\n\n");
        line.notes=components.filter(c=>c.notes).map(c=>"Component "+c.native_line_number+": "+c.notes).join("\n\n");
      }
      line.line_totals=Object.fromEntries(["list","dealer","customer"].map(k=>[k,round(components.reduce((n,c)=>n+c.line_totals[k],0))]));
      line.unit_prices=Object.fromEntries(["list","dealer","customer"].map(k=>[k,round(line.line_totals[k]/qty)]));
      const cfg=embedded(master,"unitconfiguration");
      const cw=Number(get(cfg.windowgroup,"ConfigurationWidth")),ch=Number(get(cfg.windowgroup,"ConfigurationHeight"));
      if(cw>0&&ch>0){line.width=cw;line.height=ch;}
      const seen=new Set(line.specifications.map(s=>s.label+"="+s.value));
      walk(cfg,(key,q)=>{
        if(key!=="question"||get(q,"visible")!=="True")return;
        const label=get(q,"displayname");
        const v=get(q,"answername")||get(q,"currentstringvalue")||get(q,"currentfloatvalue");
        if(!label||!v||v==="-1"||privateKey.test(label))return;
        const signature=label+"="+v;
        if(!seen.has(signature)){seen.add(signature);line.specifications.push({label,value:v});}
      });
      line.drawing=drawing(master,line.width,line.height);
      return line;
    });
    const subtotal=round(lines.reduce((n,l)=>n+l.line_totals.customer,0));
    const totals={subtotal,customer_total:numeric(root,"TotalCustomerPrice"),dealer_total:numeric(root,"TotalDealerPrice"),
      list_total:round(lines.reduce((n,l)=>n+l.line_totals.list,0)),tax:numeric(root,"totalsalestax"),freight:numeric(root,"totalfreightcharges"),
      discount:numeric(root.quotediscounttotal?.quotediscounttotals,"TotalCustomerDiscountWithCharges",true)};
    // Default Quote XML omits some customer-level charge categories. Preserve the saved balance explicitly.
    const balance=round(totals.customer_total-subtotal-totals.tax-totals.freight+totals.discount);
    if(balance!==0){
      totals.unitemized_adjustment=balance;
      warnings.push("The export includes "+new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(balance)+" in other quote-level adjustments without a category breakdown. The saved customer total is preserved.");
    }
    const header=embedded(root,"quoteheader")?.quoteheaderxml;
    const head=header?.quoteheaderdata?.quoteheader,shipping=header?.shipping?.shippingaddress,billing=header?.billing?.billingaddress;
    const details={"AMSCO quote":number,"Quote name":get(root,"quotename"),Project:get(root,"projectname"),Created:get(root,"creationdate"),
      "Last updated in AMSCO":get(root,"lastserverupdate"),"PO number":get(root,"ponumber"),Client:get(billing,"name"),"Shipping yard":get(shipping,"name"),
      "Shipping method":head?.shippingmethod?.["@_name"]||"","Salesperson":get(head,"salesperson"),"Payment terms":get(head,"salesterms")};
    const customer={};
    const client=embedded(root,"clientinfo")?.client;
    for(const [prefix,label] of [["bill","Billing"],["ship","Shipping"],["job","Job"],["contact","Contact"]]){
      for(const [key,title] of [["name","Name"],["addr1","Address"],["addr2","Address 2"],["address","Address"],["city","City"],["state","State"],["zip","ZIP"],["phone","Phone"],["mobilephone","Mobile phone"],["email","Email"],["lot","Lot"],["info","Notes"]]){
        const v=get(client,prefix+key);if(v)customer[label+" "+title]=v;
      }
    }
    for(const [node,label] of [[shipping,"Ship to"],[billing,"Bill to"]]){
      const address=["name","address1","address2","city","state","zip","country"].map(k=>get(node,k)).filter(Boolean).join("\n");
      if(address)customer[label]=address;
      for(const key of ["phone","email"]){const v=get(node,key);if(v)customer[label+" "+key]=v;}
    }
    const notes=[noteText(root.notes),get(head,"comment"),get(shipping,"shipcomment"),get(root,"SpecialOrderApprovalNotes")].filter(Boolean);
    const attachments=["SpecialOrderAttachmentFileName","SpecialOrderAttachmentFileNameMulti"].map(k=>get(root,k)).filter(Boolean);
    const refs=array(root.alllineitemmasters?.lineitemmaster);
    if(refs.length&&refs.length!==lines.length)fail("The saved line index does not match this export.");
    return validateImportedSnapshot({quote_number:number,quote_id:get(root,"id"),title:[get(root,"quotename"),get(root,"projectname")].filter(Boolean).join(" — ")||"AMSCO "+number,
      line_count:lines.length,lines,details:Object.fromEntries(Object.entries(details).filter(([,v])=>v)),customer,notes,attachments,
      totals,warnings,checked:{quote_details:true,customer:true,notes:true,line_items:true,totals:true}},expectedNumber||number);
  };
}
export async function readPrivateAmscoExport(client,body,fetchImpl=fetch) {
  if(typeof body.file_uri!=="string"||!/^private\/[^?#]+$/.test(body.file_uri)||body.file_uri.includes("..")||body.file_uri.length>1500)fail("Upload the XML file to Glass Forge first.");
  if(typeof body.filename!=="string"||body.filename.length>250||!body.filename.toLowerCase().endsWith(".xml"))fail("Choose an .xml quote export.");
  const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:body.file_uri,expires_in:120});
  if(!signed_url||!signed_url.startsWith("https://"))fail("The uploaded XML file could not be opened.");
  const response=await fetchImpl(signed_url,{signal:AbortSignal.timeout(20000),redirect:"error"});
  if(!response.ok)fail("The uploaded XML file could not be read.");
  const reader=response.body.getReader(),chunks=[];let total=0;
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>12000000){await reader.cancel();fail("Choose an XML export smaller than 12 MB.");}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const utf16=bytes[0]===255&&bytes[1]===254||bytes[0]===60&&bytes[1]===0;
  return new TextDecoder(utf16?"utf-16le":"utf-8",{fatal:true}).decode(bytes);
}

import test from "node:test";
import assert from "node:assert/strict";
import {XMLParser} from "fast-xml-parser";
import {unzipSync,zipSync,strToU8} from "fflate";
import {createAmscoXmlParser} from "../base44/shared/amscoQuoteXml.js";
import {validateImportedSnapshot} from "../base44/shared/amscoQuoteImportModel.js";
const parse=createAmscoXmlParser({XMLParser,unzipSync});
const id=n=>"00000000-0000-0000-0000-"+String(n).padStart(12,"0");
const v=(key,value)=>"<"+key+' Value="'+value+'"/>';
const c=(key,value)=>"<"+key+"><![CDATA["+value+"]]></"+key+">";
const native="<PrimeContainers><PrimeContainer><oLayers><LayerContainer><sLayerName value=\"Outside Of Frame\"/><Invisible value=\"False\"/><oPrimes><DrawLine><p1x value=\"0\"/><p1y value=\"0\"/><p2x value=\"20\"/><p2y value=\"30\"/></DrawLine></oPrimes></LayerContainer></oLayers></PrimeContainer></PrimeContainers>";
const packed=Buffer.from(zipSync({"1":strToU8(native)})).toString("base64");
function item(n,{screen=false}={}){return "<lineitem>"+v("id",id(n))+v("linenumber",screen?2:1)+v("quantity",2)+c("description",screen?"Deluxe Extruded Screen":"AMSCO 20 x 30 - Heritage Patio Door OX\nComplete Unit, White, Tempered")+v("room","Patio")+v("FrameWidth",screen?0:20)+v("FrameHeight",screen?0:30)+v("CustomerListPrice",screen?0:250)+v("dealerprice",screen?0:80)+v("customerprice",screen?0:100)+v("dealerextendedprice",screen?0:160)+v("customerextendedprice",screen?0:200)+c("linotes","<notes><note1>Keep original room note</note1></notes>")+"</lineitem>";}
function fixture(){return "<quote><ApplicationName>Amsco Window Navigator 2.0</ApplicationName>"+v("id",id(1))+v("userquotenumber","3517014")+v("quotename","Test House")+v("projectname","Test Project")+v("TotalCustomerPrice",245)+v("TotalDealerPrice",160)+v("totalsalestax",15)+v("totalfreightcharges",0)+c("notes","<notes><note1>Quote note &amp; details</note1></notes>")+"<lineitemmasters><lineitemmaster>"+v("id",id(2))+v("linenumber",100)+v("quantity",2)+"<lineitems>"+item(3)+item(4,{screen:true})+"</lineitems>"+c("serializeddrawingprimesnative",packed)+c("unitconfiguration",'<windowgroup><ConfigurationWidth>20</ConfigurationWidth><ConfigurationHeight>30</ConfigurationHeight><question><visible Value="True"/><displayname Value="Glass Thickness"/><answername Value="3/16 over 3/16"/></question></windowgroup>')+"</lineitemmaster></lineitemmasters><alllineitemmasters><lineitemmasterid Value=\"00000000-0000-0000-0000-000000000002\"/></alllineitemmasters></quote>";}
test("Default Quote XML preserves assemblies, zero-cost screens, exact prices, notes and native geometry",()=>{
 const s=parse(fixture(),"3517014");
 assert.equal(s.line_count,1);assert.equal(s.unit_count,2);assert.equal(s.lines[0].components.length,2);
 assert.equal(s.lines[0].components[1].unit_prices.customer,0);
 assert.equal(s.lines[0].unit_prices.list,250);assert.equal(s.totals.customer_total,245);
 assert.equal(s.totals.unitemized_adjustment,30);assert.equal(s.totals.labor,undefined);
 assert.equal(s.lines[0].specifications.at(-1).value,"3/16 over 3/16");
 assert.equal(s.lines[0].drawing.paths.length,1);assert.equal(s.notes[0],"Quote note & details");
 assert.match(s.lines[0].notes,/Keep original room note/);assert.equal(s.lines[0].options.glass_thickness,undefined);
 assert.equal(s.warnings.length,1);
});
test("XML rejects wrong number, wrong application, bad prices, duplicates and incomplete line index",()=>{
 for(const xml of [
   fixture().replace("Amsco Window Navigator","Other Navigator"),
   fixture().replace('Value="3517014"','Value="123"'),
   fixture().replace('dealerprice Value="80"','dealerprice Value="bad"'),
   fixture().replace(id(4),id(3)),
   fixture().replace("</alllineitemmasters>",'<lineitemmasterid Value="00000000-0000-0000-0000-000000000002"/></alllineitemmasters>')
 ])assert.throws(()=>parse(xml,"3517014"));
});
test("XML rejects malformed documents and external entities, including embedded configuration",()=>{
 for(const input of ['<!DOCTYPE quote SYSTEM "file:///secret">'+fixture(),fixture().replace("</quote>",""),fixture().replace("<windowgroup>","<!DOCTYPE windowgroup><windowgroup>")])assert.throws(()=>parse(input));
});
test("invalid native geometry cannot enter the saved snapshot",()=>{
 const s=parse(fixture());s.lines[0].drawing.paths[0].points[0]=["javascript:alert(1)",0];
 assert.throws(()=>validateImportedSnapshot(s,"3517014"),/coordinate/);
});
test("oversized compressed drawings are discarded without decompression",()=>{
 const huge=Buffer.from(zipSync({"1":new Uint8Array(1000001)})).toString("base64");
 const s=parse(fixture().replace(packed,huge));assert.equal(s.lines[0].drawing,null);
});

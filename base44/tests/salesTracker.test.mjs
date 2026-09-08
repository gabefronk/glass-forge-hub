import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {parseTracker,matchRows} from "../functions/salesTrackerImport/parser.js";
const headers=["Month PD","CLOSED","DATE","PO","OE","Builder","Subdivision","LOT #","Delivery/Arrival date","Total Sale Price","Notes","Order Folder URL"];
const make=(rows,h=headers)=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([h,...rows]),"DAILY SALES");return XLSX.write(w,{type:"buffer",bookType:"xlsx"});};
const bytes=make([
 ["","",46239,"00123","79497369","Holmes Homes","Deer Springs","263",46259,56972,"",""],
 ["","",46239,"00124","79497369","Holmes Homes","Deer Springs","266",46260,'"',"",""],
 ["","",46239,"00125","99999999","Holmes Homes","Other Community","263",46260,100,"",""]
]);
const parsed=parseTracker(XLSX,bytes);
assert.equal(parsed.rows.length,3);
assert.equal(matchRows(parsed.rows,{oe:"79497369"}).length,2);
assert.equal(matchRows(parsed.rows,{builder:" HOLMES HOMES ",subdivision:"deer springs",lot:"263"}).length,1);
assert.equal(matchRows(parsed.rows,{subdivision:"Deer Springs",lot:"999"}).length,0);
assert.equal(parsed.rows[0].po,"00123");
assert.equal(parsed.rows[1].sale_price,'"');
assert.notEqual(parsed.rows[0].arrival_date,parsed.rows[1].arrival_date);
assert.equal(parsed.rows[0].date_cell,"I2");
assert.throws(()=>parseTracker(XLSX,make([],["wrong"])),/header/);
const noDaily=XLSX.utils.book_new();XLSX.utils.book_append_sheet(noDaily,XLSX.utils.aoa_to_sheet([["wrong"]]),"JOB SCHEDULE");
assert.throws(()=>parseTracker(XLSX,XLSX.write(noDaily,{type:"buffer",bookType:"xlsx"})),/DAILY SALES/);
console.log("Sales Tracker parser: exact multi-field match, shared OE, lot-specific dates, missing match, leading zeros, raw price and wrong-sheet/header rejection passed.");

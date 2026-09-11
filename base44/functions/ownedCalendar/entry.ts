import {createClientFromRequest} from "npm:@base44/sdk@0.8.48";
import * as XLSX from "npm:xlsx@0.18.5";
import {readTrackerView} from "../../shared/salesTrackerView.js";
import {createOwnedCalendarHandler} from "./handler.js";
// Strict standard-calendar ownership: validated workbook plus committed Daily Sales additions.
export default createOwnedCalendarHandler({getClient:createClientFromRequest,readTracker:client=>readTrackerView(client,XLSX)});

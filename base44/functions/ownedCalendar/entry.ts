import {createClientFromRequest} from "npm:@base44/sdk@0.8.48";
import * as XLSX from "npm:xlsx@0.18.5";
import {readTrackerView} from "../../shared/salesTrackerView.js";
import {createOwnedCalendarHandler} from "./handler.js";
// Calendar ownership v3: strict tracker matches, timed cross-source copies combined with all notes retained.
export default createOwnedCalendarHandler({getClient:createClientFromRequest,readTracker:client=>readTrackerView(client,XLSX)});

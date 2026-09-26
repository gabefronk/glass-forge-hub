import {createClientFromRequest} from "npm:@base44/sdk@0.8.48";
import * as XLSX from "npm:xlsx@0.18.5";
import {readTrackerView} from "../../shared/salesTrackerView.js";
import {createOwnedCalendarHandler} from "./handler.js";
// Calendar ownership v3: strict tracker matches, timed cross-source copies combined with all notes retained.
// The parsed Sales Tracker workbook is kept between requests on a warm instance, keyed by the
// validated snapshot id + sha256 (see readTrackerView), so repeat calendar loads skip the
// download and XLSX parse. The calendar only reads the tracker, never writes it.
const trackerCache = new Map();
export default createOwnedCalendarHandler({getClient:createClientFromRequest,readTracker:client=>readTrackerView(client,XLSX,fetch,trackerCache)});

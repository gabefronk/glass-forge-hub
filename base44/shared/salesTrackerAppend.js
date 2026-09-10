import { normalize } from './salesTrackerParser.js';

export const TRACKER_FIELDS = ['month_paid','closed','order_date','po','oe','builder','subdivision','lot','arrival_date','sale_price','notes','order_folder_url'];
export const TRACKER_HEADERS = ['Month PD','CLOSED','DATE','PO','OE','Builder','Subdivision','LOT #','Delivery/Arrival date','Total Sale Price','Notes','Order Folder URL'];
const stable = value => JSON.stringify(value);
export const trackerOrderKey = row => normalize(row.po) && normalize(row.oe) ? stable([normalize(row.po),normalize(row.oe)]) : '';
const location = row => stable([normalize(row.builder),normalize(row.subdivision),normalize(row.lot)]);
const fingerprint = row => stable(TRACKER_FIELDS.map(key => String(row[key] ?? '').trim()));
const address = row => stable([normalize(row.builder),normalize(row.subdivision)]);
const viewRow = row => Object.fromEntries(TRACKER_FIELDS.map(key => [key,row[key] ?? '']));
function indexRows(rows) { const map=new Map();for(const row of rows)addIndexed(map,row);return map; }
function addIndexed(map,row) { const key=trackerOrderKey(row);if(!map.has(key))map.set(key,[]);map.get(key).push(row); }
function rowDecision(existing, candidate) {
  const key = trackerOrderKey(candidate);
  if (!key) return { action:'conflicting', reason:'Both PO and OE are required to identify a new row safely.' };
  const matches = existing.get(key) || [];
  if (matches.some(row => fingerprint(row) === fingerprint(candidate))) return { action:'skipped',reason:'An identical row is already present.' };
  const same = matches.find(row => location(row) === location(candidate));
  if (same) return { action:'conflicting',reason:'This PO/OE and location already exist with different values.', existing:viewRow(same) };
  // A shared order can legitimately have separate lots. Do not merge them.
  if (matches.length && matches.some(row => address(row) !== address(candidate) || !normalize(row.lot) || !normalize(candidate.lot))) {
    return { action:'conflicting',reason:'The existing PO/OE has a different or incomplete location. Review it without changing the saved row.', existing:viewRow(matches[0]) };
  }
  return { action:'inserted',reason:matches.length ? 'New lot under an existing PO/OE.' : 'New PO/OE.' };
}
export function planTrackerAppend(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming) || !incoming.length || incoming.length > 5000) throw Error('Use a delta containing 1–5,000 sales rows.');
  const accepted = [], decisions = [], current = indexRows(existing), incomingByOrder = indexRows(incoming);
  for (let index = 0; index < incoming.length; index++) {
    const row = incoming[index], key = trackerOrderKey(row);
    const sameOrder = key ? incomingByOrder.get(key) || [] : [];
    const peers = sameOrder.filter(other => location(other) === location(row));
    const conflictingPeers = key && new Set(peers.map(fingerprint)).size > 1;
    const ambiguousPeers = sameOrder.some(other => address(other) !== address(row) || location(other) !== location(row) && (!normalize(other.lot) || !normalize(row.lot)));
    const decision = conflictingPeers || ambiguousPeers ? { action:'conflicting',reason:'The uploaded file contains conflicting rows for this PO/OE and location.' } : rowDecision(current,row);
    decisions.push({ input_row:row.source_row || index+2, po:row.po,oe:row.oe,builder:row.builder,subdivision:row.subdivision,lot:row.lot,...decision,incoming:viewRow(row) });
    if (decision.action === 'inserted') { accepted.push(row);addIndexed(current,row); }
  }
  return { inserted:decisions.filter(row=>row.action==='inserted').length,skipped:decisions.filter(row=>row.action==='skipped').length,conflicting:decisions.filter(row=>row.action==='conflicting').length,decisions,rows:accepted };
}
// Immutable batches may be retried or concurrently delivered. Their logical rows
// are a set; reading them can never duplicate or overwrite a baseline row.
export function applyTrackerAppends(baseRows, batches) {
  const rows = [...baseRows], appended = [], conflicts = [], used = new Set(), indexed = indexRows(baseRows);
  for (const batch of [...batches].sort((a,b)=>String(a.imported_at).localeCompare(String(b.imported_at)) || String(a.id).localeCompare(String(b.id)))) {
    if (used.has(batch.import_key)) continue;
    used.add(batch.import_key);
    for (const [i,original] of (batch.rows || []).entries()) {
      const decision = rowDecision(indexed,original);
      if (decision.action === 'conflicting') { conflicts.push({ batch_id:batch.id,...decision,incoming:viewRow(original) });continue; }
      if (decision.action === 'skipped') continue;
      const row = {...original,source_file:batch.filename,source_capture_at:batch.source_captured_at,append_batch_id:batch.id,
        source_sheet:'DAILY SALES (append)',source_row:original.source_row || i+2,date_cell:'I'+(original.source_row||i+2),
        row_key:batch.import_key+':'+i};
      rows.push(row);appended.push(row);addIndexed(indexed,row);
    }
  }
  return { rows,appended,conflicts };
}
export function trackerViewSignature(rows) { return stable(rows.map(fingerprint).sort()); }

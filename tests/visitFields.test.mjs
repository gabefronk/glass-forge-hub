import test from 'node:test';
import assert from 'node:assert/strict';
import { visitFields, softenCaps, parseMD, visibleNotes } from '../src/lib/visitFields.js';

const textOf = (f) => JSON.stringify([f.work, f.details, f.other, f.headsUp, f.issues, f.people, f.result, f.moves, f.tags]);

const OQUIRRH_408 = {
  event_date: '2026-09-24', job_name: 'Holmes Homes - 408 Oquirrh West',
  scope_notes: 'Amsco direct – 9/23\nQTY.29\n09-2129\nOE 79661924-01\nGabe/Ragen\n\nLabor$1548-win\n',
  event_attachments: [{ title: 'NEW 1F Upgraded Flat Wall Nail-on 405 WITH Sill Pan (HOLMES HOMES).pdf' }, { title: 'Report.pdf' }],
};
const MITCHELL_505_MAY22 = {
  event_date: '2026-05-22', job_name: 'Patterson Homes - 505 Mitchell Farms',
  scope_notes: 'Andersen del to BFS – 5/12\nQTY.31 | Here: 5/11/2026\nPO 7155135\nGabe/Ragen\n\nLabor$-2055-win\n\nWestern del to BFS – 5/6\nQTY.12 - *jobsite mull required/ lift required* | Here: 4/24/2026\nPO 7155228\n\nWindor del to BFS-5/6\nQTY.1 | Here: 5/04/2026\nPO 7155255\n\nLabor$4255-win2\n\nOE: 78896112-04 ON HOLD\n         78896112-02 ON HOLD\n         78896112-01 PICK TICKET\n',
};
const GORDON_75 = {
  event_date: '2026-10-02', job_name: 'YA - #1 (L.I.) GORDON MILAR LOT 75 RIDGEVIEW',
  scope_notes: '**need to send Israel**\nANDERSEN INVESTIGATION/ADJUST\n*WARRANTY* - Per Report: front basement sliding window. It is an Andersen 400 XX slider. The window is line #16 on this acknowledgement -  (Line#: 16) *Orig. PO#: 7019456 *\n\nH/O: ALICE HAUSER 315-263-1278\nSPR: RANDY CHATWIN\nOSR: TODD W\nISR: KAYLY\n\nTECH NOTES: NEED TO ADJUST/INVESTIGAT FROM BASEMENT SV WINDOW 400XX SLIDER - window is not hung plumb, square, and level.\n\nOE: 79744804-00\nDARLENE\n\n\nANDERSEN INVESTIGATION/ADJUST\n*WARRANTY* - Per Report: 8080OX BASEMENT SGD IS HAVING PROBLEMS SHUTTING SMOOTHLY -  (Line#: 4) *Orig. PO#: 7019456 *\n\nH/O: ALICE HAUSER 315-263-1278\nSPR: RANDY CHATWIN\nOSR: TODD W\nISR: KAYLY\n\nTECH NOTES: PLEASE ADJUST THE 8080OX SGD IN THE BASEMENT TO HAVE IT CLOSE MORE SMOOTHLY *ALSO PLEASE CHECH THE WINDOW OPS\n\nOE: 79699969-00\nDARLENE\n\nComplete (9/25) –  1 hrn.\n\n  *   Per isntaller (wacker/jordan): Job is complete\n  *   1 hr\n  *   Door is fixed\n  *   400 gliding xx window pls send Anderson rep to look at I don\'t have much knowledge in this style\n  *   Missing grdis\n',
};
const MILGARD = {
  event_date: '2026-05-28', job_name: 'I - Holmes Homes 110 Lakeview',
  scope_notes: 'Milgard warranty\n*Warranty* - Per Report: 8080XO SGD in dining room-  (Line#: 18) *Orig. PO#: 6903989*\n**Product ETA – Wk of: 5/22 | PO#: 7196476 | Vendor Order #: **\n(Address confirmed: Trend)\n\n  *   11728 N STAR GAZER CIR Hideout\nReceived:5/26\n\nSPR: Rance\n\n  *   Email: rance@holmeshomes.com<mailto:rance@holmeshomes.com>   Phone: 385-867-7755\nISR: Ragen\n\n  *   Email: ragen.roark@bldr.com<mailto:ragen.roark@bldr.com>     Phone: 385.395.5930\n\nTech Instructions: Deliver / Install the active door panel where other one if falling apart\nLocation @ Site: dining room\n\nOE: 79085003-00\nDarlene 801-651-0259 darlene.keller@bldr.com<mailto:darlene.keller@bldr.com>\n',
};
const SALES = {
  event_date: '2026-09-10', job_name: 'Holmes Homes - 408 Oquirrh West',
  scope_notes: 'PO 7323212\nOE 79661924\nSale: $11,436.64\nBrand: Amsco\nFLAG: NEED UPDATED PO\nOrdered: 2026-09-10\nArrival: TBD (sheet shows ?) - event on order date\nSales Tracker DAILY SALES row 2539',
};
const MOVED = {
  event_date: '2026-08-25', job_name: 'Holmes Homes - 607 Daybreak Move Up',
  scope_notes: 'Amsco direct – 8/11\n\nQTY.31\n\n07-4963\n\nOE 79435439-01\n\nGabe/Ragen\n\n\n\nLabor$1555-win\n\n8/5 - Moved with Amsco to deliver 8/17\n8/11 - Moved with Amsco to deliver 8/20\n8/14 - Moved with Amsco to deliver 8/24\n',
};

test('408 Oquirrh install: type, brand, delivery, qty, method; refs and money never shown', () => {
  const f = visitFields(OQUIRRH_408);
  assert.equal(f.type, 'install');
  assert.equal(f.label, 'Install visit');
  assert.equal(f.brand, 'Amsco');
  assert.deepEqual(f.delivery, { method: 'Amsco direct', date: '9/23' });
  assert.equal(f.qty, 29);
  assert.match(f.method, /Nail-on 405/);
  const all = textOf(f);
  for (const bad of ['7323212', '79661924', '09-2129', 'Gabe/Ragen', '$', '1548']) assert.ok(!all.includes(bad), `leaked ${bad}`);
});

test('505 multi-vendor install: vendors with qty and Here dates, starred heads-up, OE status hidden', () => {
  const f = visitFields(MITCHELL_505_MAY22);
  assert.equal(f.type, 'install');
  assert.deepEqual(f.vendors.map((v) => [v.brand, v.qty, v.here]), [['Andersen', 31, '5/11/2026'], ['Western', 12, '4/24/2026'], ['WinDor', 1, '5/04/2026']]);
  assert.ok(f.headsUp.some((h) => /jobsite mull required\/ lift required/i.test(h)));
  assert.deepEqual(f.received, ['5/11/2026', '4/24/2026', '5/04/2026']);
  assert.ok(!textOf(f).includes('78896112'));
});

test('Gordon Milar service: two per-report issues and two work items, people, result log', () => {
  const f = visitFields(GORDON_75);
  assert.equal(f.type, 'service');
  assert.equal(f.label, 'Service visit');
  assert.ok(f.tags.includes('Warranty'));
  assert.ok(f.tags.includes('Andersen Investigation/Adjust'));
  assert.deepEqual(f.issues.map((i) => i.line), ['16', '4']);
  assert.equal(f.work.length, 2);
  const roles = f.people.map((p) => p.role);
  for (const r of ['Homeowner', 'Super', 'OSR', 'ISR', 'Service coord.']) assert.ok(roles.includes(r), r);
  assert.equal(roles.filter((r) => r === 'Homeowner').length, 1, 'repeated people collapse');
  assert.ok(f.result.some((r) => /Door is fixed/.test(r)));
  assert.ok(f.result.some((r) => /Complete \(9\/25\)/.test(r)));
  assert.ok(f.headsUp.some((h) => /need to send Israel/i.test(h)));
  assert.ok(!textOf(f).includes('7019456'));
});

test('Milgard warranty: email bullets join the person, location and parts ETA in details, address hidden', () => {
  const f = visitFields(MILGARD);
  assert.equal(f.brand, 'Milgard');
  const sup = f.people.find((p) => p.role === 'Super');
  assert.match(sup.text, /Rance/);
  assert.match(sup.text, /385-867-7755/);
  assert.ok(!sup.text.includes('mailto'));
  assert.deepEqual(f.details.find((d) => d.k === 'Location'), { k: 'Location', v: 'dining room' });
  assert.deepEqual(f.details.find((d) => d.k === 'Parts ETA'), { k: 'Parts ETA', v: 'Wk of 5/22' });
  assert.deepEqual(f.details.find((d) => d.k === 'Parts received'), { k: 'Parts received', v: '5/26' });
  assert.equal(f.work[0], 'Deliver / Install the active door panel where other one if falling apart');
  assert.ok(!textOf(f).includes('STAR GAZER'));
});

test('sheetrock return trip', () => {
  const f = visitFields({ event_date: '2026-10-02', scope_notes: 'Please install sheetrock windows.\n | Auto-reconciled: field report filed 2026-10-02.' });
  assert.equal(f.type, 'return');
  assert.equal(f.label, 'Return trip');
  assert.deepEqual(f.tags, ['Sheetrock windows']);
  assert.deepEqual(f.work, ['Please install sheetrock windows.']);
  assert.deepEqual(f.other, []);
});

test('framing return trip keeps the trip-charge line out of view', () => {
  const f = visitFields({ event_date: '2026-09-03', scope_notes: 'Framing issues fixed, please finish install.\n\nSubpay $75  – invoice to framers\n' });
  assert.equal(f.type, 'return');
  assert.deepEqual(f.tags, ['Framing fixed']);
  assert.ok(!textOf(f).includes('$'));
});

test('sales tracker event is an order: ordered date, flag, no sale amount', () => {
  const f = visitFields(SALES);
  assert.equal(f.type, 'order');
  assert.equal(f.label, 'Order placed');
  assert.equal(f.brand, 'Amsco');
  assert.deepEqual(f.details.find((d) => d.k === 'Ordered'), { k: 'Ordered', v: '2026-09-10' });
  assert.ok(f.headsUp.includes('Need updated PO'));
  assert.ok(!textOf(f).includes('$') && !textOf(f).includes('11,436'));
});

test('delivery moves become a list', () => {
  const f = visitFields(MOVED);
  assert.deepEqual(f.moves, ['8/5 - Moved with Amsco to deliver 8/17', '8/11 - Moved with Amsco to deliver 8/20', '8/14 - Moved with Amsco to deliver 8/24']);
});

test('html notes parse like plain lines; empty notes give empty rows', () => {
  const f = visitFields({ event_date: '2026-09-25', scope_notes: 'Replace 1626 FX glass, primary bath<br>Labor $450<br>PO 7302254<br>Replace 2646 SH pantry deadlight' });
  assert.deepEqual(f.work, ['Replace 1626 FX glass, primary bath', 'Replace 2646 SH pantry deadlight']);
  const e = visitFields({ event_date: '2026-09-25', scope_notes: null });
  assert.equal(e.type, 'custom');
  assert.equal(e.label, 'Visit');
  for (const k of ['work', 'issues', 'people', 'details', 'headsUp', 'moves', 'result', 'other', 'tags', 'vendors']) assert.deepEqual(e[k], [], k);
});

test('every non-blank line lands in exactly one bucket', () => {
  for (const ev of [OQUIRRH_408, MITCHELL_505_MAY22, GORDON_75, MILGARD, SALES, MOVED]) {
    const f = visitFields(ev);
    const lines = String(ev.scope_notes).split('\n').map((l) => l.trim()).filter(Boolean);
    assert.equal(f.lineCount, lines.length);
    assert.equal(f.placed, f.lineCount, ev.job_name);
  }
});

test('softenCaps keeps codes and sizes uppercase', () => {
  assert.equal(softenCaps('TECH NOTES: ADJUST THE 8080OX SGD'), 'Tech notes: adjust the 8080OX SGD');
  assert.equal(softenCaps('Already mixed Case stays'), 'Already mixed Case stays');
  assert.equal(softenCaps('NEED UPDATED PO'), 'Need updated PO');
});

test('parseMD turns M/D and M/D/YYYY into ISO dates using the event year', () => {
  assert.equal(parseMD('9/23', 2026), '2026-09-23');
  assert.equal(parseMD('5/04/2026', 2025), '2026-05-04');
  assert.equal(parseMD('nope', 2026), '');
});

test('screen service + Todd template: refs scrubbed, reps hidden, screens date and coord kept', () => {
  const f = visitFields({ event_date: '2026-04-20', scope_notes: 'Pella Screen Service: 10 Window screens | 6 PD screen *PO#: 6977819 / 6977826\nReceived: in warehouse per james\nScreens Requested Date: 4/21\nSPR: Haylee Holmes (801) 746-9332\nDeliver / Install all screens. Check OPS: Lock and Slide *Please take VIDEO of sgd operating*\n78916751-00\n(RP 385.505.4784)\n' });
  assert.equal(f.type, 'service');
  assert.ok(f.tags.includes('Pella Screen Service'));
  assert.ok(f.work.some((w) => /10 Window screens/.test(w)));
  assert.deepEqual(f.details.find((d) => d.k === 'Screens requested'), { k: 'Screens requested', v: '4/21' });
  assert.deepEqual(f.details.find((d) => d.k === 'Parts received'), { k: 'Parts received', v: 'in warehouse per james' });
  assert.ok(f.people.some((p) => p.role === 'Service coord.' && /385\.505\.4784/.test(p.text)));
  const all = textOf(f);
  for (const bad of ['6977819', '6977826', '78916751']) assert.ok(!all.includes(bad), `leaked ${bad}`);

  const g = visitFields({ event_date: '2026-09-22', scope_notes: 'AMSCO DIR SHIP 9/22\n\n1F\n\nQTY. 53\n\nAMSCO ORDER #: 09-1360\n\nTODD WARTMAN/KAYLY\n\nOE: 79646895-01 / PO: 7319874\n\nLABOR: $2268/WIN\n\nWIN\n\nGABE 801-834-3421\n\n9/16 – Moved with Amsco to deliver 9/23\n\nTYVEK INSTALL W/SILL PAN\n\n08-923\n' });
  assert.equal(g.type, 'install');
  assert.equal(g.qty, 53);
  assert.deepEqual(g.moves, ['9/16 – Moved with Amsco to deliver 9/23']);
  assert.ok(g.details.some((d) => d.k === 'Install type' && /1F/.test(d.v)));
  assert.ok(g.details.some((d) => d.k === 'Install type' && /Tyvek install w\/sill pan/i.test(d.v)));
  const gall = textOf(g);
  for (const bad of ['09-1360', 'WARTMAN', 'Wartman', '79646895', '7319874', 'Win', '801-834-3421', '08-923']) assert.ok(!gall.includes(bad), `leaked ${bad}`);
  assert.deepEqual(g.other, []);
});

test('installer/tech report lines go to result', () => {
  const f = visitFields({ event_date: '2026-06-01', scope_notes: 'Per Tech (Elijah):\nReplaced sash\nReschedule (6/3) – 30 min.' });
  assert.deepEqual(f.result, ['Per Tech (Elijah)', 'Replaced sash', 'Reschedule (6/3) – 30 min.']);
});

test('visibleNotes keeps the original wording but drops refs, reps and money lines', () => {
  const v = visibleNotes(OQUIRRH_408);
  assert.equal(v, 'Amsco direct – 9/23\nQTY.29');
  const g = visibleNotes({ scope_notes: '*Warranty* - Per Report: SGD sticks (Line#: 4) *Orig. PO#: 6903989*\nOE: 79085003-00\nTech Instructions: adjust it' });
  assert.equal(g, '*Warranty* - Per Report: SGD sticks (Line#: 4)\nTech Instructions: adjust it');
  assert.equal(visibleNotes({ scope_notes: null }), '');
});

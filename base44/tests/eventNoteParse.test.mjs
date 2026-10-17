import test from "node:test";
import assert from "node:assert/strict";
import { parseEventNote } from "../../src/lib/eventNoteParse.js";

const CRYPTON = `MILGARD DEL TO BFS
BFS DEL TO JOBSITE
1F
QTY. 44 | here: 9/18/2026
Qty. 25 | Here: 9/28/2026
Qty 8 | Here: 10/06/2026
TODD SORENSEN/KAYLY
OE: 79589515-01 / PO: 7307302

LABOR: $5198/WIN

MILGARD DEL TO BFS
BFS DEL TO JOBSITE
QTY. 8
1F
TODD SORENSEN/KAYLY
OE: 79704973-00 / PO: 7332730

CALL TODD S. WITH ANY QUESTIONS/CONCERNS 385-505-2479`;

test("crypton phoenix note parses into two delivery blocks plus a call note", () => {
  const p = parseEventNote(CRYPTON);
  assert.equal(p.blocks.length, 2);
  const [b1, b2] = p.blocks;
  assert.equal(b1.route, "MILGARD → BFS → JOBSITE");
  assert.equal(b1.floor, "1F");
  assert.deepEqual(b1.deliveries, [
    { qty: 44, date: "9/18/2026" },
    { qty: 25, date: "9/28/2026" },
    { qty: 8, date: "10/06/2026" },
  ]);
  assert.deepEqual(b1.contacts, ["TODD SORENSEN / KAYLY"]);
  assert.equal(b1.oe, "79589515-01");
  assert.equal(b1.po, "7307302");
  assert.equal(b1.needsReview, false);
  assert.equal(b2.po, "7332730");
  assert.equal(b2.oe, "79704973-00");
  assert.deepEqual(b2.deliveries, [{ qty: 8, date: null }]);
  assert.equal(b2.floor, "1F");
  assert.deepEqual(b2.contacts, ["TODD SORENSEN / KAYLY", "TODD S."]); // call note joins the open block
  assert.deepEqual(p.phones, ["385-505-2479"]);
  assert.deepEqual(p.review, []);
});

test("labor line attaches to the open block", () => {
  const p = parseEventNote("MILGARD DEL TO BFS\nQTY. 4 | here: 9/1/2026\nPO: 1234567\nLABOR: $1,200/WIN");
  assert.equal(p.blocks.length, 1);
  assert.deepEqual(p.blocks[0].labor, { amount: 1200, unit: "WIN" });
  assert.equal(p.blocks[0].po, "1234567");
});

test("unknown lines go to review, never guessed", () => {
  const p = parseEventNote("random sentence with no pattern\nPO: 7654321");
  assert.deepEqual(p.review, ["random sentence with no pattern"]);
  assert.equal(p.blocks[0].po, "7654321");
});

test("block without refs is flagged for review", () => {
  const p = parseEventNote("MILGARD DEL TO BFS\nQTY. 3");
  assert.equal(p.blocks[0].needsReview, true);
});

test("empty and null notes parse clean", () => {
  assert.deepEqual(parseEventNote(""), { blocks: [], review: [], phones: [] });
  assert.deepEqual(parseEventNote(null), { blocks: [], review: [], phones: [] });
});

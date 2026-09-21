# Job Budgets + Unpaid Vendor Orders

Feature branch: `feat/job-budgets`. Nothing here is published; Base44 picks it up
only when the branch is merged and Gabriel says go.

## What Gabriel asked for (his words)

> "a jobs budget page where whenever I drop a pdf file into it or pdf files it
> builds out a cost basis and a profit margin and it goes into google drive under
> Glass Forge jobs and under the builders folders and either finds the specific job
> matching it or if there is none it makes a new folder and puts it in there with
> the budget sheet fully filled out. Then it also updates our invoicing page and
> job tracking so once I get an eta for the glass from Steve it can update and
> notify me and the customer. I still need to play with this more to figure out
> what all it needs to trigger but you get the general idea."

Plus the follow-up: an **unpaid jobs tracker** - every ordered-but-unpaid vendor
order with order number, vendor, amount, payment route (ACH link from the vendor's
system, paid by Israel on Gabriel's ok), and status
`ordered -> ETA -> ACH link received -> paid -> reconciled`.

## What the attachments showed

- **Window Budget Sheet.xlsx** is the budget definition. Yellow input cells:
  builder/lot/address block, manufacturer, quantity of openings, material true
  cost from the quote (C15), labor cost/sell, extras, and the actual total sell
  (C28). Formula cells: use tax 7.45% (C20), cost material/tax (C21), target sell
  at 30% material / 27% labor margin (C22/C25), total cost incl. overhead (C27),
  actual margin % (C29). `shared/jobBudgetMath.js` replicates these formulas
  exactly and is verified against his filled sheet for the BAXTER job
  (cost basis 1,350.63, target sell 1,929.46, actual margin 44.0%).
- **Amsco quote 3517590 ("BAXTER - GLASS")** is the PDF shape: dealer totals
  (what GF pays: 1,256.98) vs customer totals (2,411.81 incl. 167.22 tax),
  quote #, quote name, quoted-by (Israel), per-line quantities (4 openings).
  `shared/vendorQuoteParse.js` parses this layout deterministically; other
  vendors go through the document LLM with the same normalized output.

## End-to-end flow (built on this branch)

1. **Drop** - Job Budgets page (`/job-budgets`, owner-only nav). Multi-PDF drag
   drop or picker. Each file uploads to Base44 storage, then `jobBudgetIngest`.
2. **Extract** - deterministic AMSCO text parse when text is available, else
   `InvokeLLM` against the PDF with a strict schema (nulls, never guesses).
   Output: vendor, quote #/name, builder, bill/ship-to, openings qty, dealer
   cost, customer total, tax.
3. **Budget** - `computeJobBudget()` runs the workbook math. The page also shows
   a live "quick margin check" scratchpad with the same math.
4. **Match** - quote tokens (quote name, builder, address) are scored against
   Jobs records with the Hub's existing normalized-customer rules. Exactly one
   confident match links the job; zero or split evidence lands in
   `needs_review` with candidates - nothing attaches on weak evidence, matching
   the Hub's job-identity philosophy.
5. **File** - find-or-create `Glass Forge Jobs/<Builder>/<Job>` in Drive (the
   same root the plans pipeline uses). Unmatched quotes go to
   `Glass Forge Jobs/_Unmatched Quote Drops/<Quote Name>` so nothing fabricates
   a builder folder. Uploads: the original quote PDF, a **filled copy of his
   real workbook** (`Window Budget Sheet - <job>.xlsx`, template embedded, yellow
   cells in, formula results cached so any viewer shows numbers), and a CSV
   summary for quick preview.
6. **Records** - a `JobBudgets` entity row (extraction, inputs, computed budget,
   Drive ids/paths, job link, glass-ETA fields). On a confident match, this
   month's `JobCostInputs` is upserted with product cost/sell + quote number,
   which is exactly what the Invoicing page reads for job profitability.
7. **Unpaid orders** - `VendorOrders` entity + the tracker section on the same
   page. Log an order (or it can be created from a budget), then advance it
   down the chain; every transition is stamped in `status_history`. "Reconciled"
   is the only state that leaves the open-payables list; the header keeps a
   running outstanding total.

## The glass-ETA chain (Steve)

Gabriel's trigger: "once I get an eta for the glass from Steve it can update and
notify me and the customer."

Design: **one watcher, one write path, drafts for anything customer-facing.**

- `jobBudgetIngest` action `set_glass_eta` is the single write path: updates the
  JobBudgets glass-ETA fields and flips a linked VendorOrder `ordered -> eta_set`
  with history. It never messages anyone.
- A watcher (scheduled function, same pattern as the other Hub agents) reads
  Steve Chapman's threads on the messages bridge and Gmail for ETA language
  ("glass ready", "will be in", dates) tied to a quote name / order number, then
  calls `set_glass_eta`.
- Notification split, following the Hub's existing draft-only rule:
  - **Gabriel**: Hub to-do + a text ("BAXTER glass ETA Sept 30, order 09-3900").
  - **Customer**: *draft only* in the Service assistant style. Gabriel taps send.
    Customer-facing automation on his behalf is a representation risk he has
    consistently kept draft-only.

## Where his trigger ideas have gaps - and the simpler shape

His instinct ("figure out what all it needs to trigger") points at several loose
ends. Gaps, with the simpler answer:

1. **"Drop PDFs" vs. where PDFs actually arrive.** Vendor quotes also arrive by
   email and text. Gap: page-only drops miss those. Simple answer: keep the page
   as the canonical intake; add a Drive "Quote Drops" inbox folder later using
   the paused plans-inbox pattern *only if* he stops dropping them himself.
2. **Matching ambiguity.** "Finds the specific job or makes a new folder" hides
   the hard case: two jobs for one builder, or a quote name that matches nothing.
   Gap: auto-creating folders for every unmatched quote would litter Drive.
   Answer: `_Unmatched Quote Drops` + needs_review list on the page; filing a
   review item re-runs filing into the right job folder.
3. **Invoicing update scope.** He said "updates our invoicing page" - the
   unambiguous part is the cost basis (JobCostInputs, built). What he may also
   mean is ready-to-bill fee lines from budgets, which is *not* built: billing
   routes (BFS vs YA vs direct) decide that, and auto-creating charges would
   double-bill. Design: budgets stay cost-side until he says how a budget becomes
   an invoice line.
4. **"Notify the customer."** Gap: which customer, which channel, what wording.
   Answer: draft-only, tied to the job's super/customer contact already linked
   on the job page.
5. **Payment triggers.** The unpaid tracker answers "who pays and when" with a
   status chain, but the real trigger is the ACH link arriving by email/text from
   the vendor system. Same watcher pattern as the glass ETA can catch "payment
   link" messages and flip `eta_set -> ach_link_received` with the link attached.
6. **Reconciliation.** Unpaid orders (payables) vs job budget (cost basis) vs
   builder funds (receivables in invoicing): the monthly close should show
   ordered-not-paid totals next to budgeted material cost so cash out is visible
   before the builder pays. `VendorOrders.reconcile_note` records how each
   payment ties out; a monthly "unreconciled" roll-up is the natural next build
   after he uses the tracker.

## Reconciliation angle (built for, not yet surfaced)

- Every VendorOrder carries `budget_id`/`job_id`, so a job page can show
  budget cost vs orders placed vs paid vs builder invoiced in one place.
- The tracker's outstanding total is the payables number the finance agent's
  monthly close needs.

## Seed data (create on publish)

One upsert seeds the known open order:

```json
{
  "action": "upsert_order",
  "order": {
    "order_number": "09-3900", "vendor": "AMSCO",
    "po_name": "YA Windows 3 Strings", "billed_account": "Brian Beitzel",
    "payment_route": "ach_link", "payer": "Israel", "status": "ordered",
    "amount": 3254.77,
    "notes": "ACH link pending; Israel pays on Gabriel's ok"
  }
}
```

## PO numbers

Current YA PO assignments: **3 Strings = YA-0001**, **Baxter = YA-0002**. Use these when filing quotes/orders for those jobs.

## Files on this branch

- `base44/shared/jobBudgetMath.js` - workbook math, verified against the template
- `base44/shared/vendorQuoteParse.js` - AMSCO dealer-quote parser + normalizer
- `base44/shared/jobBudgetSheet.js` + `jobBudgetTemplateXlsx.js` - filled workbook
  (his real template embedded) + CSV summary
- `base44/entities/JobBudgets.jsonc`, `base44/entities/VendorOrders.jsonc`
- `base44/functions/jobBudgetIngest/entry.ts` - process / upsert_order /
  advance_order_status / set_glass_eta
- `src/pages/JobBudgets.jsx` + route + owner-only nav (desktop + mobile)
- `tests/jobBudgetMath.test.mjs`, `vendorQuoteParse.test.mjs`,
  `jobBudgetSheet.test.mjs`, `tests/fixtures/amsco-dealer-quote-3517590.txt`

## Known limits / open questions for Gabriel

- The workbook's extras cells (C18/C19) are written only when we know he types
  them there; the current fill leaves them blank (formulas treat blank as 0).
- The template's B31 `#REF!` (deleted Builders list sheet) exists in his file
  today; carried through unchanged.
- AMSCO parses deterministically; other vendors rely on the document model until
  their layouts earn their own parsers.
- `JobCostInputs.material_source` is set to `manual` for budget drops (the
  `linked_quote` enum expects a QuoteRequests link).
- Customer notification wording/channel needs his call before anything sends.

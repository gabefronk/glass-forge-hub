# Job-centered Budget & Orders

## Current state
Implementation saved in the Base44 editor repository. Publication is NOT confirmed. The selective CLI deployment attempted for procurement, issue_purchase_order and jobBudgetIngest stopped at the Base44 device-login step without deploying. A signed-in browser walkthrough has not been completed.

Before-change checkpoint commit: 072c461b568ea8102fe91afbe7563da0da651db8.

## What changed
- Existing Jobs pages retain their structure; a Budget & Orders link opens /jobs/:id/budget-orders.
- Purchasing overview replaces the two separate navigation entries. Old /job-budgets and /purchase-orders links redirect without deleting records.
- Quotes, working budgets, purchase orders, supplier tracking and invoicing links share the existing job ID.
- PDF quotes start as drafts; reviewed scopes can be included, kept as references, or marked as replacing earlier versions. Existing records are retained.
- Missing costs and selling prices withhold margin totals. Supplier amounts are not copied from whole-job customer prices.
- PO preparation requires explicit review, keeps a source snapshot, uses request keys and a shared compare-and-set purchasing lock. Existing conflicting references are flagged, not rewritten.
- Invoice navigation is scoped to the job and accounting month. Linking an estimate writes separate budget_snapshot metadata, not actual revenue, labor, fees, invoices or payment records.
- Working-budget edits preserve prior inputs. First-time setup uses included scopes, and tax-inclusive budget totals are not taxed again as subtotals. Saved customer setup/contract records are not rewritten.

## AV24 example actually saved
Existing job: 6ab65a0af4c7aab207863abb, AV24 - Aria-Belle - 1212 North Luna Circle - RETRO, Justin Hutchins.
New draft budget: 6ac1dd9fc4a4bee0b1b9bd0e, AMSCO quote 3523394.
Stable request key: av24-3523394-screenshot-v1.
Material before tax: $869.20; tax shown: $64.76; existing supplier amount: $933.96.
Four windows: two 35.5 x 71.5 and two 35.5 x 83.5, plus a $0 screen bag.
Labor, final homeowner sell, full job cost and margin remain unconfirmed.
Screenshot file: 1RQtzjYyg944EmRTpP5-gRAWls08Kp_eH, in the existing job Drive folder 1MUXUe3vkKMr6XZw4zo1cOUwOwC-5-aM5.
The screenshot was transcribed as an image-source draft; it was not processed as a PDF and no filled workbook was generated for this example.
Existing supplier order 6ab65a44037bfd1a7a204886 (09-5476) now has only its budget_id added. Its amount, ETA, payment status and PO reference were preserved.
Job record read-back still has updated_date 2026-09-26T20:38:46.884000; no existing job fields were edited.
No purchase order, vendor purchase, invoice, payment, email or calendar event was created by this example.

## Verification completed
51 targeted Node tests passed, 0 failed:
node --test tests/procurement.test.mjs tests/procurementFollowup.test.mjs tests/jobBudgetMath.test.mjs tests/jobBudgetReview.test.mjs tests/jobMoneyPanel.test.mjs tests/jobSetup.test.mjs base44/tests/purchaseOrderSetup.test.mjs

npm run build: exit 0.
ESLint on changed purchasing, setup, invoicing and navigation components: exit 0.
Backend bundle checks for procurement, issue_purchase_order and jobBudgetIngest: exit 0.
Source comparison against the before-change commit confirmed no changes to JobsHub, Jobs entity, job identity/grouping, workbook math, fee math, invoice readiness filters or CalendarPage.
These are code/build tests with mocked services, not proof of production behavior.

## Remaining release checks
Publish through an authenticated Base44 session, then verify the three purchasing handlers while signed in. Open the AV24 job, confirm the screenshot draft and supplier link, navigate between purchasing and job-scoped invoicing, and verify existing jobs/history remain intact. Do not issue a test PO, alter a real invoice or mark any payment for a smoke test.
Run npm run check:published-pricing and verify an existing priced window while signed in, as required by AGENTS.md.

YA-0005 remains a pre-existing cross-job conflict (Sandy PO versus AV24 supplier reference). No renumbering or speculative relinking has been performed. Resolve from authoritative supplier/job evidence before associating an actual PO.

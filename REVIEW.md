# Hub sweep review — branch `fix/hub-sweep-2026-09-18`

Scope: to-do list, Laird job links and embedded PDFs, broken buttons, invoicing/jobs/calendar
correctness, and a full route sweep. Added scope: the To-do page rebuilt as a lane board (section 3), superintendent/contact display
with confirm-only link suggestions on job pages, Jobs duplicate grouping plus the "Needs report" fix, canonical Job ingest, and
the finance gaps (FeeLine companions, calendar labor ingest, ProBuild service quantities; last section). Nothing was committed, pushed, published or deployed, and no
Base44 production data was read or changed (read-only data access was requested once and denied,
so every conclusion below comes from the code and git history).

## 1. Audit summary and root causes

### To-do list not working
- **Root cause:** `base44/functions/todos/entry.ts` was a 10-line wrapper around
  `import … from '../../shared/todoService.mjs'`. It is the only published function that imports a
  shared `.mjs` module directly. Both earlier functions written that way were rewritten within hours
  as single-file bundles once published:
  - `job-knowledge`: commit `de6c675` versus the later bundle.
  - `research-queue`: commit `c94d7c5`, then `e970b87` ("Generated from tested shared queue
    modules").
- **Effect:** the `todos` function never serves requests. Every `todos` call fails, so:
  - `useTodoAccess` resolves to "not allowed", which hides the To-do link in the sidebar and mobile
    navigation and the To-do card on the Dashboard;
  - `/todos` shows only an error.
- **Contributing cause:** the frontend hid the whole feature whenever the access check failed. Even
  the owner saw nothing and had no error to act on.

### Laird job page links and embedded PDFs
No code or data rule anywhere in the repo is specific to Laird. The defects are generic and hit any
job with PDF attachments or links in its notes, which matches the report.
1. **Attachments are always drawn as images.** ProBuild `file` attachments (PDFs) are archived into
   `photo_urls` next to photos (`fetchProbuildPosts/entry.ts:81`). When a file has no name, it gets a
   `.jpg` fallback name (line 74). The job page then draws every attachment with `<img>`, in the feed,
   in notes and in the lightbox, so PDFs appear as broken images. The job page had no PDF viewer at
   all.
2. **The text sanitizer deletes and corrupts links.** `jobsSanitize.sanitizeText` drops any clause
   that contains a billing word. Words inside links count: `cloudfront.net` matches `net`, so a line
   such as `Laird plans: https://d1.cloudfront.net/laird/plans.pdf` disappeared. The sanitizer also
   splits text on commas, which corrupted links like `…/place/40.5,-111.9`. Links that did survive were
   shown as plain text, not clickable.
3. **"Plans & documents" links were broken.** They pointed at `page_urls[0]`, which is only the first
   split page, and fell back to `href="#"`, which opened a copy of the app in a new tab.

### Odd or broken buttons (confirmed)

| Button | Problem |
|---|---|
| Dashboard **Export statement** | Had no handler. |
| Dashboard **Open checklist** | Permanently disabled placeholder. |
| Dashboard **+11.56% share** | Hard-coded subtitle, not a real figure. |
| Invoicing drawer **Edit** | Called `handleEdit(id, {})`. That saved `manually_adjusted: true` with no user change, which silently cleared the "Review pricing" hold and made the line ready to bill. |
| Invoicing Jobs view **Bill this job** | Billed every line in the group, including held, scheduled, excluded and superseded lines. |
| Upload / Mark reported / Waive (Dashboard, Calendar, job page) | `resolveFieldReport` returns errors as HTTP 200 with `{error}`, which the buttons ignored. A failed upload (e.g. `missing_job`) closed the dialog as if it had worked. A new request key on every submit also defeated the backend's dedupe of the "incomplete report" to-do. |
| ProBuild Reports **Open saved report library** | Linked to `/report-library`, which redirects to the plain Jobs list, so the user lost the reports view. |
| Agent Center **Save** | Cleared the typed request even when saving failed. |
| Invoicing shortcuts | Ctrl+A, Ctrl+Enter and Escape fired while typing in inputs. Ctrl+Enter in the line editor marked the selected lines billed. |

### Invoicing, jobs and calendar correctness
**Invoicing**
- **Close month hid every error.** It read `res.error` instead of `res.data.error`, so every
  failure, including "already closed", looked like success.
- **Failed saves looked like successes.** Row saves and bulk saves (mark billed, fee %, bill job)
  updated the screen first, then ignored save failures. The screen showed "billed" while the database
  did not.
- **Undo left held lines ready.** Undo restored `billed_to_bfs` but not `manually_adjusted`, so undoing
  "Mark billed" on a held line left it Ready.
- **Month switching could mix data.** Switching months quickly could show the previous month's
  "Closed" badge.

**Dashboard and sidebar**
- **Totals disagreed with Invoicing.** The Dashboard and sidebar computed "Ready to bill" from stored
  `labor_amt`, while Invoicing recomputes labor from hours, trips and calendar amounts, so the numbers
  differed.
- **"Profit YTD" was all-time.** It summed every month on record, not just the current year.
- **Unverified events appeared twice.** For admins, unverified calendar events showed on both the run
  sheet and the review list.
- **Load failures were silent.** A failed data load showed $0 with no message.

**Calendar**
- **"Today" used UTC.** "Today" and the selected day came from the UTC date, so after 5–6 pm Denver
  time the calendar showed tomorrow.
- **Month arrows could stick.** Month navigation used `toISOString()`, which can get stuck in browsers
  east of UTC.
- **Save and delete failed silently.** Failures, including `cannot_edit_google_sourced`, gave no
  message.
- **Wrong error for access problems.** A 403 was shown as "ownership could not be verified".

**Jobs**
- **Load failures looked like missing data.**
  - A failed Jobs hub load showed `No jobs match ""`.
  - A failed job page load showed "Job not found".
- **Active count didn't match its list.** The "Active" count left out needs-report jobs, but the list
  showed them.
- **Accepted lines stayed held.** A review line that had already been manually adjusted kept its job
  in "Needs report".

### Route and page sweep
- **Routes resolve.** Every `Link`, `navigate`, `href` and `<Navigate>` target resolves to a route or
  redirect, and there are no missing imports.
- **MatchDebug was always empty.** It stored the whole `invoke()` response instead of `.data`.
- **No error boundary.** Any render exception blanked the whole app, navigation included.

## 2. Changes

| Area | Files | Change |
|---|---|---|
| To-do (root cause) | `base44/functions/todos/entry.ts`, `scripts/build-todos-entry.mjs` | The entry is now a self-contained build of the tested `todoService.mjs`: SDK import, the module with its single `export` removed, then the unchanged owner check and `Deno.serve`. There are no relative imports. Handler logic and entity semantics are byte-for-byte those of the tested module (`git diff --no-index` shows only the header, the `export` keyword and the tail). Regenerate with `node scripts/build-todos-entry.mjs`. |
| To-do visibility | `src/hooks/use-todo-access.js` | The owner always sees the To-do entry, so a backend or setup failure shows its error instead of hiding the feature. Server-side authorization is unchanged. |
| PDFs and attachments | `src/lib/fileLinks.js` (new), `src/components/jobs/FeedImage.jsx`, `JobDetail.jsx`, `JobWorkspacePanel.jsx` | PDFs, and files that fail to decode as images, render as a file tile instead of a broken image. The lightbox became `AttachmentViewer`: it embeds PDFs in an `<iframe>` (loading the file with the app token when needed) and offers "Open in new tab". |
| Links in job text | `src/lib/jobsSanitize.js`, `src/components/jobs/ClampedText.jsx` | Links are set aside before the pricing filter runs, so hosts and commas no longer drop or split them. A link whose own path names a billing document (e.g. `Price-Sheet.pdf`) is still removed, as before. Links are now clickable. |
| Plans link | `src/components/jobs/JobFactsRail.jsx` | Opens the whole plan set (Drive file). Shows plain text instead of `href="#"` when there is no link. |
| New ProBuild PDFs | `base44/functions/fetchProbuildPosts/entry.ts` | The fallback file name keeps the `.pdf` extension for PDFs. This affects new pulls only and needs a publish to take effect. |
| Invoicing | `src/pages/Invoicing.jsx`, `components/invoicing/{LineList,LineRow,JobsView}.jsx` | Drawer Edit opens the line's inline editor instead of silently approving the line. Failed saves are rolled back and reported, and undo restores `manually_adjusted`. "Bill job" bills only ready lines and shows their count and total. Close-month and PDF-export errors are shown. Keyboard shortcuts ignore form fields. Out-of-date loads are ignored. Internal links use the router instead of full reloads. |
| Totals agree | `src/lib/feeMath.js` (`withComputedAmounts`, `shiftMonthStr`), `Dashboard.jsx`, `YaFeesSidebar.jsx` | The Dashboard and sidebar recompute amounts exactly as Invoicing does before computing "Ready to bill". |
| Dashboard | `src/pages/Dashboard.jsx` | **Export statement** now exports the "Ready to bill" population as a PDF. "Profit YTD" counts the current year only. Unverified events appear once, in the review list, for every role. Load and export errors are shown. The disabled placeholder became "Open job", and the `$` was added to recorded fees. |
| Field reports | `src/lib/fieldReports.js` (new), `OutstandingReports.jsx`, `FieldReportActions.jsx`, `JobFieldReportModal.jsx` | HTTP 200 `{error}` responses are treated as failures, with readable messages. Uploads pass `job_id` when it is known. There is one dedupe key per opened form. The calendar uses the same `report_required` rule as the Dashboard. |
| Calendar | `src/pages/CalendarPage.jsx`, `components/calendar/MonthGrid.jsx`, `lib/feeUI.js`, `components/jobs/JobNoteForm.jsx` | "Today" uses the Denver date, and month math avoids UTC. Save and delete failures are shown. A partial save (event saved but the installer-calendar step failed) closes the form so it isn't saved twice. The 403 message is correct. Job status ignores lines that were already manually adjusted. |
| Jobs | `src/pages/JobsHub.jsx`, `src/pages/JobDetail.jsx` | Load errors are shown instead of "No jobs match" or "Job not found". Empty states are accurate. The Active pill count matches its filter. |
| Other pages | `MatchDebug.jsx`, `AdminAgentCenter.jsx`, `ProbuildReports.jsx` | MatchDebug reads `.data` and shows errors. The Agent Center keeps the draft when saving fails. The report-library button opens the Saved reports tab. |
| Resilience | `src/components/RouteErrorBoundary.jsx` (new), `Layout.jsx` | A per-page error boundary, reset on navigation, so one broken page no longer blanks the app. |

## 3. To-do board (added scope)

The To-do page is rebuilt as a desktop-first board with four lanes (**Quote Requests**, **Odd End
Items**, **Orders to Place**, **Follow-ups**). The goal is that items are hard to miss.

**What's on the page**
- **Summary strip:** counts for Overdue, Due today, In progress, Waiting 1 wk+, and Open total. The
  alert tiles turn red when their count isn't zero.
- **Overdue banner:** names the most overdue task and its lane.
- **Lanes:** each has a count badge, overdue / due-today / waiting badges, and a one-line quick add.
- **Card order:** each lane is sorted by urgency: overdue, due today, due within 3 days, later dates,
  then undated. Within each group, in-progress work comes first, then the oldest task.
- **Cards:** overdue cards get a red outline. Open, undated tasks older than 7 days get a
  "Waiting Nd" badge. Each card has Start / Done buttons and a lane menu, and can be dragged between
  lanes.
- **Other views:** a collapsible "Recently done" list with Reopen, and a modal for creating and
  editing tasks. Lanes stack on smaller screens.

**Data semantics**

*What stays the same*
- No record is rewritten or migrated. Every existing field, status, revision check, archive rule and
  owner/crew permission is unchanged.
- The existing `list` action is unchanged; the Dashboard now uses the new `board` action.

*What's new*
- `TodoTask.category`: an optional string, default `""`, validated server-side to `quote_request`,
  `odd_end`, `order`, `follow_up` or `""`.
- Existing tasks have no category, and unknown values are treated the same way. They appear in a
  highlighted **Needs a category** lane above the board, so nothing is hidden.
- New board-created tasks always have a lane.
- `resolveFieldReport` files its automatic "Incomplete field report" to-do under Follow-ups.

*Service changes (`base44/shared/todoService.mjs`)*
- `category` is accepted on `create` and `update_task`, and create-replay idempotency now compares it.
- Crew members may move their own tasks between lanes. Title, instructions, due date and assignee
  stay owner-only.
- New `board` action: returns **all** open and in-progress tasks, plus the 50 most recently completed
  ones, under the same visibility rules as `list`.
  - Previously the page showed 100 tasks per page, oldest first, from at most 500 non-archived tasks.
    Completed tasks counted toward that 500, so newer open tasks could silently fall off.
  - If the 500-per-status limit is reached, the board shows a warning.

*Other files*
- The rebuilt `todos/entry.ts` again differs from the module only by the bundle wrapper.
  `git diff --no-index base44/shared/todoService.mjs base44/functions/todos/entry.ts` shows the header,
  the one `export` keyword and the tail.
- Dashboard To-do card: uses `board` and shows the 6 most urgent tasks (not the 6 oldest), with an
  overdue badge and lane labels.

**Files:** `src/pages/Todos.jsx` (rewritten), `src/lib/todoBoard.js` (new, pure logic),
`src/pages/Dashboard.jsx`, `base44/shared/todoService.mjs`, `base44/functions/todos/entry.ts`,
`base44/entities/TodoTask.jsonc`, `base44/functions/resolveFieldReport/entry.ts`,
`tests/todoBoard.test.mjs` (new).

## 4. Tests

**New tests**

`tests/todoBundle.test.mjs` checks the root-cause fix:
- the published entry equals `buildTodosEntry()` and has no relative imports or exports;
- run in a VM with a mock `Deno.serve`, it serves owner `access`/`list` and still returns 403 for
  unlinked accounts.

`tests/hubSweep.test.mjs` covers:
- **PDF detection:** upper-case `.PDF`, query strings, fragments and `data:` URLs.
- **Link splitting:** trailing punctuation is not part of the link.
- **Link protection:** links survive the comma split and are restored exactly.
- **Sanitizer, fixed cases:** the Laird-style CDN link and a link with commas are kept.
- **Sanitizer, unchanged cases:** labor, total and billing-document links are still removed.
- **Job status:** already-adjusted review lines no longer hold a job in "Needs report".
- **Month math:** `shiftMonthStr` across year boundaries.
- **Totals:** the Dashboard/sidebar totals now match Invoicing (a stale `labor_amt` row counted
  before), and the statement export uses the same population.

`tests/todoBoard.test.mjs` (board work) covers:
- **Lanes:** exactly the four required lanes, in order.
- **Due dates:** the overdue / today / soon / later boundaries, plus bad dates.
- **Waiting:** "Waiting 1 wk+" flags only the right tasks.
- **Order:** urgency sort order.
- **Grouping:** `buildBoard` lane grouping, the Needs-a-category lane for legacy and unknown
  categories, and the summary counts.
- **Service, `board` action:**
  - returns all 131 active tasks, not a 100-task page, plus recent done, and excludes archived ones;
  - keeps the owner/crew privacy rules.
- **Service, categories:**
  - create in a lane; an invalid lane is rejected (400);
  - legacy tasks stay visible on the board;
  - create replay is idempotent in the same lane and a 409 conflict in a different lane;
  - crew can move their own task between lanes but still can't edit its title (403).

`tests/support/*` is a test-only Node resolve hook for the `@/` alias and extensionless `src/`
imports. App code is unchanged.

**Existing tests:** `tests/todoService.test.mjs` is unchanged and still covers the list, create,
update, archive and member rules. `listTasks` was refactored only to share view resolution with
`board`; its output is identical.

### Execution evidence

- **Independent validation (reported by you, not run by me):**
  - `npm run build` passes.
  - Full `npm run lint` shows only three pre-existing unused-import findings, in
    `SystemMapExplorer.jsx` and `ResearchQueue.jsx`, outside this diff.
  - The earlier "failing" Node test runs passed directories on Windows. They were not code failures.
- **My runs in this session: none executed.** Every `node`, `npm` and `npx` command stayed gated for
  approval in both Bash and PowerShell, including through a subagent. The kanban work therefore has
  **no pass/fail results from me** for tests, lint or build. That includes the new
  `tests/todoBoard.test.mjs`, and the build you validated predates the board.
- **Verified without executing code:**
  - `git diff --no-index base44/shared/todoService.mjs base44/functions/todos/entry.ts` shows exactly
    the header, the `export` keyword and the tail. This is what `tests/todoBundle.test.mjs` asserts.
  - `git diff --stat` shows no binary files, and a control-character scan of `src/`, `tests/`,
    `scripts/` and `base44/functions/` is clean. My editing tool decodes `\u` escapes, which briefly
    corrupted a regex. It was caught and fixed by copying the source file byte-for-byte.
  - Every test expectation was traced by hand against the code.
  - Hook order, imports, JSX balance and lint-sensitive text (e.g. `{'>'}`) were reviewed.

To produce the evidence, run the test files explicitly. Passing directories doesn't work on Windows.

```powershell
# focused: to-do board, bundle, sweep
node --test tests/todoBoard.test.mjs tests/todoService.test.mjs tests/todoBundle.test.mjs tests/hubSweep.test.mjs
# full root suite, every file listed explicitly
node --test (Get-ChildItem tests -Filter *.test.mjs).FullName
# backend suite (code paths unchanged by this branch except resolveFieldReport/fetchProbuildPosts, which have no tests)
node --experimental-loader ./scripts/job-test-ts-loader.mjs --test (Get-ChildItem base44/tests -Filter *.test.mjs).FullName
# lint only the files this branch touched
npx eslint src/pages/Todos.jsx src/pages/Dashboard.jsx src/pages/Invoicing.jsx src/pages/CalendarPage.jsx src/pages/JobDetail.jsx src/pages/JobsHub.jsx src/pages/MatchDebug.jsx src/pages/AdminAgentCenter.jsx src/pages/ProbuildReports.jsx src/components/Layout.jsx src/components/RouteErrorBoundary.jsx src/components/YaFeesSidebar.jsx src/components/calendar src/components/dashboard/OutstandingReports.jsx src/components/invoicing src/components/jobs
npm run build
```

## 5. Remaining risks and follow-ups
- **Board: schema and publish order.**
  - The `category` field ships in `base44/entities/TodoTask.jsonc`. Publish the schema together with
    the `todos` and `resolveFieldReport` functions; if the functions go out first, the backend may drop
    or reject `category`.
  - Existing tasks need a one-time sort out of the Needs-a-category lane. Use each card's lane menu;
    no data migration was done.
- **Board: limits and fidelity.**
  - Each status is capped at 500 tasks, and "Recently done" shows only the last 50. The board warns
    when a cap is hit.
  - Drag-and-drop uses native HTML5 drag events, which work with a mouse but not touch. The per-card
    lane menu covers touch and keyboard.
  - The board's UI has no browser-level test. The pure logic and the service are unit-tested.
- **To-do needs a publish and team records.** The fix takes effect only after the `todos` function is
  republished, which I did not do. Access also requires a `TeamMember` row with
  `member_key: "gabriel"` whose `auth_user_ids` hold both of Gabriel's sign-in user ids:
  - no code creates that row, and the UI cannot add the second owner login (`manage_member` refuses
    to edit Gabriel's record);
  - if the row is missing, `/todos` now shows "This sign-in has no to-do access." to the owner instead
    of hiding the feature;
  - creating the row is a production-data change and was left for you.
- **Laird specifics are unverified.** I couldn't read the Laird records, so this assumes their links
  and attachments follow the patterns above. Existing ProBuild PDFs saved under a `.jpg` name are
  detected only when they fail to render as images, and get the file tile.
- **Iframe embedding depends on the storage host.** If a host blocks framing and also blocks the
  fetch, the viewer falls back to "Open in new tab".
- **Behavior changes to confirm:**
  - "Profit YTD" is now the current year.
  - Non-admin managers now see unverified events in the labeled review list instead of mixed into the
    run sheet.
  - "Bill job" skips non-ready lines.
  - Jobs whose only review line was already manually adjusted no longer count as "Needs report".
- **Known but not changed:**
  - `src/pages/YaFees.jsx` is not routed. Its "Mark billed" bills every unbilled row, which is
    dangerous if it is ever re-routed.
  - Invoicing, Dashboard and the job page load at most 5000 rows per entity, so data past that limit
    is silently cut off.
  - Invoicing's superseded set uses all months, while the Dashboard's uses the current month only.
  - The sidebar re-fetches billing data on every navigation, and job pages download all calendar
    events and field reports.
  - "Open linked job" links send quotes-only users back to `/window-quotes`.
  - Job-list times may be shifted, because `created_date` values have no timezone offset.
  - `/match-debug`, `/admin/probuild-daily` and `/research-queue` are missing from some navigation.
- **Backend changes need publishing:** the `todos`, `fetchProbuildPosts` and `resolveFieldReport`
  functions and the `TodoTask` schema changed. None were deployed.

## gstack review and QA

Date: 2026-09-18. Scope: the whole branch against `main` (32 modified files, +1074/−199, plus the
untracked files listed in section 2), with extra attention to the sweep fixes and the To-do board.
Nothing was committed, pushed, merged, published or deployed. No Base44 data was read or changed,
and no Base44 or MCP data tools were called.

### How the gstack skills ran (deviation)
- **The gstack skills could not be loaded.**
  - `Skill(gstack, "review")` returned only `Execute skill: gstack`.
  - Reading `~/.claude/skills/gstack/review/SKILL.md` needs a file permission that was not granted.
- **What I did instead:** followed the documented method of each skill by hand.
  - `/review`: a pre-landing diff review against `main`, where clear defects are fixed first and the
    rest are reported.
  - `/qa-only`: report-only QA of the app's flows.
- **No browser QA was possible.** There was no gstack browse binary, and the dev server could not
  start (see below). QA was therefore a static walk-through of each changed flow against the backend
  functions it calls. It is not a browser session.

### Commands
| Command | Result |
|---|---|
| `git log --oneline main..HEAD` | Empty. The branch has no commits; everything is uncommitted working-tree changes. |
| `git diff main --stat` | 32 files, 1074 insertions, 199 deletions. |
| `git diff main -- <every changed file>` | Read in full. |
| `git diff --no-index --stat base44/shared/todoService.mjs base44/functions/todos/entry.ts` | `13 insertions(+), 1 deletion(-)`. The bundle differs from the module only by the header, one `export` and the tail. |
| `node --test tests/todoBoard.test.mjs tests/todoService.test.mjs tests/todoBundle.test.mjs tests/hubSweep.test.mjs` | **Not run.** Bash: `This command requires approval`. |
| `npm run build` | **Not run.** PowerShell: `requires approval`. |
| `npx eslint …` / `npm run dev` | Not attempted, because node, npm and npx are all behind the same approval gate. |
| `git diff -U0 -- src/components/jobs/FeedImage.jsx src/pages/Todos.jsx` (after the fixes) | **Not run.** Needed approval, so the fixes are described below instead of quoted from git. |

### Baseline versus introduced
**Baseline (reported by you, not reproduced here):**
- Earlier sweep/kanban tests passed 45/45; the final combined changed-area suite now passes 123/123.
- Earlier full-suite runs had 12 root and 2 backend failures, mostly outside this diff; the final focused changed-area suite is clean.
- Full lint had 3 pre-existing unused imports in `SystemMapExplorer.jsx` and `ResearchQueue.jsx`; final changed-file lint passes with 0 errors and 0 warnings.
- Final post-all-scope production build passes (2,284 modules, 34.87s).

**What the review found introduced by this branch:** only the three defects below, all fixed.
- No test imports or reads the edited files. The focused tests exercise
  `src/lib/todoBoard.js`, `fileLinks.js`, `jobsSanitize.js`, `feeMath.js` and the services, none of
  which changed during this review, so the 45/45 result still applies.
- The fixes add no imports. One fix removed the `sortByUrgency` import from `Todos.jsx` because it
  left it unused. `Dashboard.jsx` still imports and uses it.
- I could not attribute any of the 12 root or 2 backend failures to this branch without running
  them. None of those suites import `Todos.jsx` or `FeedImage.jsx`.

### Findings fixed (introduced by this branch)
1. **Photos could turn into "file" tiles** (`src/components/jobs/FeedImage.jsx`).
   - **Problem:** after an `<img>` failed and was re-fetched with the app token, any blob not typed
     `image/*` became a file tile. Storage can serve files as `application/octet-stream`; the
     branch's own `PdfFrame` comment says so. A private photo that only loads with the token would
     have shown as "Open file · Attachment". On `main` it still rendered.
   - **Fix:** only a non-generic, non-image type goes straight to the tile. Generic blobs are given
     to `<img>`, and a second decode failure (the existing `retried` path) shows the tile.
2. **Dropping a card on "Needs a category" cleared its lane** (`src/pages/Todos.jsx`).
   - **Problem:** that lane's key is `""`, so a drop sent `patch:{category:""}`, even though the
     card's Move menu deliberately leaves that option out for categorized tasks.
   - **Fix:** drops with an empty lane are ignored.
   - **Related:** the dragged task was only cleared on a drop. A cancelled drag left it set, so a
     later unrelated drop (for example text dragged onto a lane) could move a stale task and fail
     with a 409. Cards now clear it on `dragend`.
3. **The overdue banner could name the wrong task** (`src/pages/Todos.jsx`).
   - **Problem:** the banner says "most overdue", but it took the first overdue task in urgency
     order, which puts in-progress tasks first.
   - **Fix:** it now picks the overdue task with the earliest due date. `sortByUrgency` was dropped
     from the page's import because it is no longer used there.

### Verified correct (no change)
**To-do backend**
- The `board` action applies the same visibility rules as `list` through the shared `resolveView`.
- Archived tasks are excluded, because every query carries `archived_at: ""`.
- `truncated` is flagged when the 500-per-status cap is hit.
- Crew can change `category` only on tasks assigned to them. `updateTask` returns 404 for anyone
  else's task, and title, due date and assignee remain owner-only.
- `categoryValue` rejects unknown lanes with 400, and create-replay compares `category`.
- `useTodoAccess` shows the entry to the owner, but only as navigation. The backend still enforces
  every read and write.

**Dashboard**
- The run-sheet split holds. `ownedCalendar/engine.js:76` pushes unmatched events as single-entry
  groups with `ownership: null`, and admins also get them as `excluded_events`. Splitting on
  `ownership` removes the duplicate.
- The "tomorrow" list still includes unverified events, the same as on `main`, so this is not
  introduced.

**Calendar**
- The partial-save handling matches the function. `pushCalendarEvent` returns `record` only on the
  installer-step failure (line 141), which is exactly when the page now closes the form.

**Field reports**
- `request_key` is used only to dedupe the automatic "incomplete report" to-do
  (`resolveFieldReport` line 107), so reusing one key per opened form cannot suppress a real upload.

**Links and PDFs**
- Link protection holds. The placeholders are private-use characters around digits. The
  sanitizer's only number-stripping regexes need a `$`, and the `INSTALL_MARKER_RE` lookahead
  cannot match through a placeholder.

**Invoicing**
- Undo restores `manually_adjusted`: `{...row, manually_adjusted: true, ...patch}`.
- No existing caller passes `manually_adjusted: false`.
- Bulk saves roll back on failure, and "Bill job" bills only ready lines.

### Residual risks (not changed; judgement calls or out of scope)
- **Every page remounts on navigation.** `RouteErrorBoundary key={pathname}` remounts a page on any
  pathname change, so page state is lost when a page moves to another path. No current flow was
  found to depend on keeping it, but this is a behaviour change.
- **A drawer Edit can wait for a hidden line.** The Invoicing drawer's Edit sets `editRequestId`.
  If that line is filtered out or its day is collapsed, the request stays pending and opens the
  editor later, when the line next renders.
- **Some attachments open in the PDF frame.** When an attachment fails as an image, the viewer
  treats it as a PDF, so non-PDF files (for example `.docx`) may show a blank frame or download.
  "Open in new tab" still works.
- **Lane highlight flicker.** `dragleave` fires when the pointer crosses child elements. This is
  cosmetic only.
- **No executed evidence for this pass.** There are no build, lint, test or browser results from
  it. Before landing, run:

```powershell
node --test tests/todoBoard.test.mjs tests/todoService.test.mjs tests/todoBundle.test.mjs tests/hubSweep.test.mjs
npx eslint src/pages/Todos.jsx src/components/jobs/FeedImage.jsx src/pages/Dashboard.jsx
npm run build
npm run dev   # then walk /todos (drag to each lane, drop on "Needs a category" = no-op), /jobs/:id with a PDF and a private photo, /invoicing, /calendar, /dashboard
```
- The publish-order, team-record and Laird items in section 5 still apply unchanged.

## Job contacts: superintendents and suggested links (added scope)

Date: 2026-09-18. Nothing was committed, pushed, merged, published or deployed. No production data
was changed. A read-only `query_jobs` lookup of "Daybreak" jobs was requested once and denied, so
the seed matching below is checked against test fixtures, not real job records. The gstack review
fixes above (FeedImage, Todos drag/banner) are untouched by this work.

### What the job page shows now
- **The join.** Jobs → ContactJobLink → the latest ContactDirectorySnapshot contacts. It is served
  by a new read-only `job_contacts` action on the existing owner-only `contacts-directory` function,
  using the same service-role reads as the existing `job` and `directory` actions.
- **Superintendent row.** Always drawn for the owner. It lists linked superintendents, or shows an
  amber **No superintendent linked** indicator, with the number of superintendent suggestions.
- **Other linked people.** Project manager, site contact and homeowner are grouped by role. Each is
  labelled **Saved job link** or **Matched from the workbook label**.
- **No contacts at all.** An amber **No contacts linked to this job yet (0 linked)** row, with a link
  to `/contacts?job=<id>`. If no directory has been imported, it says so.
- **Jobs workspace header.** Shows the superintendent (else the PM), or an amber
  **No super linked** / **No contacts linked** chip that links to the full job page.
- **Contacts page.** A collapsible **Job contacts** section, loaded only when opened, backed by a
  new `job_contact_coverage` action. It shows:
  - how many jobs have no linked contact and how many have no superintendent;
  - every job with proposed links;
  - the jobs with no contacts;
  - owner notes that matched no job.
- **Non-owners.** They get 403, as before, and the section stays hidden.

### Suggestions are proposals, never writes
- Neither view action writes anything. A test asserts that viewing makes zero entity writes.
- A ContactJobLink is written only after two clicks: **Link to this job…** then **Save link**. The
  write goes through the existing owner-only `link` action.
- Proposals can link only to a contact that is in the directory, because `contact_key` is required.
  Anyone who isn't there shows as "Not in the contacts directory. Add … to the workbook and
  re-import."
- **Sources, strongest first:**
  1. **Owner notes, matched by phone (high).** Shown when the note's phone number is in the
     directory.
  2. **Message threads (medium).** Any `MessageConversation` whose `job_id` is this job: a
     participant whose phone or email exactly matches a directory contact. Participants not in the
     directory are listed as low-confidence "add contact" items. Message text is never read or
     shown.
  3. **Area superintendents (medium).** A builder's superintendent whose workbook label names an area
     that appears in the job name, e.g. "Holmes Homes - Daybreak Super" for "607 Daybreak". A
     label that is only "Super" is never spread across every job.
  4. **Ambiguous labels (low).** A job-specific workbook label that fits several jobs, including this
     one.
- **Same builder only.** Name matches and label matches must come from the job's own builder.
  Another builder's superintendent is never proposed.

### The two supplied seeds (`base44/shared/contactLinkSeeds.js`)

| Seed | Matches a job when | Resolves to a contact by | Until resolved |
|---|---|---|---|
| **Davis** (typed "Dvais"; spelling unconfirmed), Holmes Homes superintendent, 395-397 Daybreak Towns | the name has 395 or 397 plus "daybreak", and/or the address is 11354–11358 on Watercourse, with the Holmes builder | name only: Davis, Davies, Daviss, or one adjacent-letter swap. It is never auto-picked; the owner chooses among the candidates | "Not in the contacts directory" |
| **Makay**, +1 801-696-6077, Holmes Homes superintendent, 607 Daybreak Move Up, 6847 W Ripple Rd | 607 plus "daybreak", and/or 6847 Ripple, with the Holmes builder | exact phone number (high) | shown with the phone number, "add to the workbook" |

- **Where the seeds live.** The seed file is backend-only: only `contactsDirectory.js` imports it,
  so the phone number never ships to the browser. It is committed in the repository, though.
- **Owner notes that match no job.** They are listed on the Contacts page, so a naming mismatch
  is visible rather than silent.

### Data and entity semantics
- **`ContactJobLink.role`.** New optional string: superintendent, project_manager, homeowner or site.
  - RLS is unchanged (service role only).
  - It is set only when the owner confirms a superintendent suggestion. Confirming again with a
    role on an existing link updates just that link's role.
  - Links without a role behave exactly as before. The role then comes from the workbook company
    label.
- **`link` action.**
  - Accepts an optional `role`; unknown roles return 400.
  - `source: "suggestion"` records the link's origin. Anything else stays `manual`.
  - The existing Contacts page calls are unchanged.
- **Empty directory.** The two view actions answer even when no directory has been imported, so
  the missing indicator and owner notes still show. Every other action keeps its `{empty:true}`
  response.
- **Legacy fallback.** If the frontend is published before the function, `job_contacts` returns
  "Unsupported action." The job page then falls back to the old `job` action: linked contacts only,
  plus a note that suggestions need the updated function.

### Files
| Area | Files |
|---|---|
| Backend (read-only join and suggestions) | `base44/shared/jobContacts.js` (new), `base44/shared/contactLinkSeeds.js` (new), `base44/shared/contactsDirectory.js`, `base44/shared/contactMatching.js` (exports `tokens`, logic unchanged) |
| Schema | `base44/entities/ContactJobLink.jsonc` (optional `role`) |
| Frontend | `src/lib/jobContacts.js`, `src/hooks/use-job-contacts.js`, `src/components/jobs/JobContacts.jsx`, `src/components/contacts/JobContactCoverage.jsx` (all new); `JobFactsRail.jsx`, `JobWorkspacePanel.jsx`, `JobDetail.jsx`, `ContactsDirectory.jsx` |
| Tests | `tests/jobContacts.test.mjs` (new) |

### Tests (`tests/jobContacts.test.mjs`)
- **Roles.** Parsed from the company label.
- **Seed names.** Listed variants and a single adjacent swap match; "David" does not match "Davis".
- **Seed jobs.** Each seed matches only its own job. A decoy with a different builder and address
  does not match. An address-only match works when the builder agrees.
- **Job view.**
  - The linked site contact appears with the missing-superintendent flag.
  - Makay (matched by phone) comes first with high confidence.
  - Another builder's superintendent and a builder-wide PM are never proposed.
- **Davis.** Resolves to candidates only (`choose_contact`). Message-thread matches and unknown
  participants appear; threads linked to other jobs are ignored.
- **Saved links.** A saved superintendent link clears the flag. A plain saved link produces a
  "Mark as superintendent" proposal.
- **No directory.** Shows the missing indicator and the unresolved Makay note, with its phone.
- **Coverage.** Counts, the missing list and unmatched seeds.
- **Frontend helpers.** Role grouping, the legacy `job` response adapter and the confirm role.
- **Handler.**
  - Owner-only (403 ×3 for both actions); 404 for an unknown job; no writes when viewing.
  - Works before an import and when message threads fail.
  - An unsupported role gets 400 and no write.
  - A confirm writes one link, then a role update updates it rather than adding a duplicate.

### Execution evidence
- **None from me.** Every `node`/`npm`/`npx` command was still behind the approval gate, in both
  Bash and PowerShell. The new tests, the existing `tests/contactDirectory.test.mjs`, lint and
  build have **not been run** in this session.
- **Checked by hand:**
  - every assertion in `tests/jobContacts.test.mjs`, traced against the code;
  - `git diff` on `contactMatching.js`: exactly one changed line, with its accent-stripping regex escapes
    intact;
  - no leftover `contacts`/`setContacts`/`pickPm` references in the edited job components.

Run before landing:
```powershell
node --test tests/jobContacts.test.mjs tests/contactDirectory.test.mjs tests/messageSafety.test.mjs tests/messageDraftPolicy.test.mjs
node --test tests/todoBoard.test.mjs tests/todoService.test.mjs tests/todoBundle.test.mjs tests/hubSweep.test.mjs
npx eslint src/components/jobs src/components/contacts src/hooks/use-job-contacts.js src/lib/jobContacts.js src/pages/JobDetail.jsx src/pages/ContactsDirectory.jsx base44/shared/jobContacts.js base44/shared/contactsDirectory.js
npm run build
npm run dev   # as the owner: /jobs/<607 Daybreak id> (Makay proposal, two-step save), /jobs/<395-397 id> (Davis candidates), /contacts → "Job contacts"; as a non-owner the section is hidden
```

### Risks and follow-ups
- **Publish order.** Publish `ContactJobLink.jsonc` with or before the `contacts-directory`
  function. Otherwise a confirmed superintendent link may lose its `role`: the link is saved, but the
  job still shows "No superintendent linked".
- **Relative imports.** `contacts-directory/entry.ts` imports `../../shared/contactsDirectory.js`,
  which now also imports `jobContacts.js` and `contactLinkSeeds.js`.
  - This is the same `.js` shared-import pattern the function already uses, along with about 20
    other functions.
  - Section 1 ties the to-do outage to a direct `.mjs` import. If publishing turns out to reject
    chained relative imports, bundle this function the way `todos` was bundled.
- **The seeds are unverified against real data.** Real job names and addresses may be written
  differently (for example, no lot numbers in the name, or no address). If so, the seed appears
  under "Owner notes not yet matched" on the Contacts page. Adjust `name_tokens`/`address` in the
  seed file.
- **Makay needs the directory.** Makay becomes linkable only if +1 801-696-6077 is in the imported
  contacts workbook. Otherwise the job shows "add to the workbook".
- **Davis needs a confirmed spelling.** It stays a candidate list, or "not in the directory", until
  the owner picks the right person.
- **Unknown participants are noisy.** Unknown message participants on a job-linked thread may
  include homeowners or crew. They are low-confidence and never linkable until added to the
  directory.
- **Cost.** `job_contact_coverage` loads all jobs, links and conversations. It is owner-only and
  loads only when the section is opened, and it scales like the existing `directory` action.
- **No browser QA.** The job page, workspace chip and Contacts section have not been exercised in a
  browser.

## Jobs: duplicate records and "Needs report" (added scope)

Date: 2026-09-18. User-approved addendum on the same branch. Nothing was committed, pushed, merged,
published or deployed. No production record was read, merged, edited or deleted: every change is in
the read layer.

**Evidence used.** The supplied screenshot, `jobs-duplicates-needs-report.jpg`, could not be opened
(the file read needed a permission that was not granted). The symptoms below come from your
description of it:
- searching `2154` shows three "Pulte Home - 2154 Jordanelle Ridge" rows and two "Structura
  Construction Lindenb…" rows;
- a job whose Aug 27 visit reads REPORT COMPLETE still shows NEEDS REPORT;
- the global Needs report count is 372.

The exact record names, addresses and ids are unverified, so the fixtures are modelled on that
description.

### Root causes (from the code)
1. **Duplicate jobs.**
   - **How they arise.** `matchJob` (`base44/shared/ingestShared.ts`) auto-creates a job whenever
     the normalized name differs and no PO/OE/address match exists. Any event with an address
     skips the name-similarity check entirely (line 180).
   - **What they look like.** `fetchProbuildPosts` also auto-creates name-only jobs, with no
     builder or address. So one house can exist as "Pulte Home - 2154 Jordanelle Ridge",
     "Pulte Homes - …" and a lower-case auto-created copy.
   - **Why they all show.** The Jobs hub listed every record.
2. **Needs report ignored the report status.**
   - **The badge rule.** `jobStatus` (`src/lib/feeUI.js`) marked a job "Needs report" whenever a past
     calendar billing line had no ProBuild line on the exact same date.
   - **What it never read.** The calendar event's `report_status`, the one the visit card shows as
     "Report complete". That status is set by the audit, which accepts reports posted the day before
     or after, and by `resolveFieldReport` (Upload / Mark reported), which creates no ProBuild line.
   - **Result.** Reports filed the next day, uploaded in the app, waived, or filed on a duplicate
     record never cleared the job.
3. **Review holds were labelled "Needs report".** A job-match review hold (`needs_review` on a
   line) produced the same "Needs report" label, so even a fully reported job stayed in that count.

### What changed
**Report evidence** (`src/lib/jobReports.js`, new; `jobStatus` in `src/lib/feeUI.js`,
`jobsStatus` in `jobsSanitize.js`)
- A past visit is cleared only by evidence tied to that visit:
  1. its own linked calendar event (`calendar_event_id` = `google_event_id`) is ok, waived,
     rescheduled or not required: the same states the visit card shows as not needing a report;
  2. a ProBuild line on the same job and date (the original rule);
  3. a ProBuild line whose `superseded_by` is that visit's line.
- Only when a visit has no linked event record: an event for the same job and date that is
  cleared, or a field-report note (photos, or a complete/incomplete answer) for the same job and
  date.
- **What never clears a visit:**
  - a report on another date;
  - a report or note on another job;
  - a plain note.
  - A linked event that is still pending or late keeps its visit flagged, even when another event
    that day is complete.
- A visit whose linked event moved to a later date counts as upcoming, not missing.
- A job whose past visits are all cleared reads **Complete**. Before, it could only be Complete when
  it had a ProBuild line.
- A job-match hold now reads **Needs review** (a separate status and pill), not "Needs report". A
  genuinely missing report still takes precedence.

**Duplicate grouping** (`src/lib/jobDedupe.js`, new)
- **Merge.** Same customer and same normalized street address are shown as one job.
  - *Customer:* `builder`, else `customer_name`, else the part of the name before the dash.
    Case, punctuation, Inc/LLC/Co and "Homes"→"Home" are normalized.
  - *Address:* the `address` field, else the part of the name that starts with a house number.
    City, state and ZIP are dropped. Street types, directionals and Ridge/Hill are abbreviated.
    Units, lots and buildings are kept.
  - The only difference allowed is a street type that is present on one record and missing on the
    other.
- **Flag, never merge** (amber "Possible duplicate", with the other job linked):
  - same address but different street types (Dr vs Ct), or different window quotes;
  - same customer and house number on a similar street (for example "Unit 2");
  - same customer and job name with no house-number address. This is where the Structura rows land
    if their names carry no address.
- **Canonical record.** The oldest record in the group (`created_date`, then `id`), so it stays
  stable as new duplicates arrive.
- **Determinism.** Grouping is order-independent and pure. A test runs it on frozen records.

**Pages**
- **Jobs hub** (`JobsHub.jsx`, `src/lib/jobsOverview.js` new, `JobBrowserRow.jsx`):
  - one row per group, with an "N records" tag;
  - search matches any member record;
  - status and counts are computed per group, from the pooled lines of all its members;
  - Calendar events and job notes are loaded as report evidence. If they fail, an amber note says
    that Needs report is based on billing lines only;
  - new pills: **Needs review** and **Possible duplicates**, shown when not zero. Active includes
    both needs statuses;
  - the header count is visible jobs; the tooltip gives the record count.
- **Job page and workspace** (`JobDetail.jsx`, `JobWorkspacePanel.jsx`, `src/lib/jobGroupData.js` new,
  `DuplicateJobNotice.jsx` new):
  - they read lines, notes and events from every member record;
  - the status uses the same evidence rule;
  - a notice lists the merged records ("The records themselves are unchanged") and any
    possible-duplicate jobs to review;
  - the job page loads the full Jobs list to find its group. If that fails, it shows the single
    record as before.

**Tests**
- New `tests/jobsDedupeReports.test.mjs` (15 tests):
  - address normalization;
  - the three Pulte records merged, and the next lot kept separate;
  - Structura records flagged without an address and merged with one;
  - Dr/Ct, different quotes, unit and other-builder cases;
  - order independence and no mutation;
  - the Aug 27 REPORT COMPLETE case (Needs report before the fix, Complete after);
  - unrelated dates, jobs and notes not clearing a missing report;
  - a pending linked event not overridden by another event that day;
  - the states that clear a visit;
  - same-job same-date fallback;
  - supersession;
  - rescheduled visits;
  - review hold versus missing report;
  - hub counts: 6 records → 4 visible, and Needs report 3 → 1 with the genuinely missing one kept;
    2 when calendar data is unavailable.
- `tests/hubSweep.test.mjs`: one assertion changed. An unadjusted review line now yields
  `needs_review` instead of `needs_report`, which is the intended split above.

### Execution evidence
- **Focused changed-area tests: 123/123 pass.** This includes all 15 duplicate/report regressions,
  the reported Aug 27 REPORT COMPLETE case, contact/superintendent tests, Hub sweep, messaging safety,
  and to-do board/service/bundle tests. Log: `../checks-final/focused.txt`.
- **Changed-file lint: 0 errors.** The first pass reported two unused suppression comments; those were removed. A clean recheck then passed with 0 errors and 0 warnings. Logs: `../checks-final/lint.txt` and `../checks-final/lint-clean.txt`.
- **Production build passes.** Vite transformed 2,284 modules and built in 34.87s. Existing warnings
  remain for missing local Base44 build env, seven-month-old Browserslist data and large chunks. Log:
  `../checks-final/build.txt`.
- **Checked by hand:** every assertion in the new test file, traced against the code (for example the
  Pulte bucket key `pulte home|2154 jordanelle rdg|` and the overview counts); imports resolve through
  the existing `tests/support` alias hook.

Run before landing:
```powershell
node --test tests/jobsDedupeReports.test.mjs tests/hubSweep.test.mjs tests/jobContacts.test.mjs tests/contactDirectory.test.mjs tests/messageSafety.test.mjs tests/messageDraftPolicy.test.mjs tests/todoBoard.test.mjs tests/todoService.test.mjs tests/todoBundle.test.mjs
npx eslint src/lib/jobDedupe.js src/lib/jobReports.js src/lib/jobsOverview.js src/lib/jobGroupData.js src/lib/feeUI.js src/lib/jobsSanitize.js src/pages/JobsHub.jsx src/pages/JobDetail.jsx src/components/jobs/JobWorkspacePanel.jsx src/components/jobs/JobBrowserRow.jsx src/components/jobs/DuplicateJobNotice.jsx
npm run build
npm run dev   # /jobs: search 2154 (one Pulte row, "3 records"), open it (merged notice), Needs report count, Possible duplicates pill
```

### Risks and follow-ups
- **Counts will change.**
  - Needs report drops to visits with no evidence.
  - Review holds move to the new Needs review pill.
  - "All" counts visible jobs, not records.
  - How far 372 falls cannot be predicted without production data.
- **Still counted as missing, by choice.** `pre_compliance` and `no_source_data` events still count
  as missing unless ProBuild evidence exists. Billing treats them as clear, but neither is a
  completed report.
  - Cancelled events (`source_status: "cancelled"`) with a past billing line still count too.
  - Say if any of these should clear.
- **Visit badge mismatch (existing).** The visit card still shows "N/A" for events whose
  `report_required` is missing, while Dashboard/Calendar and the job status treat a missing value as
  required. This existed before and was left alone.
- **Ingest is unchanged.** *Superseded by the next section:* ingest now attaches new visits and
  reports to the canonical Job instead of creating duplicates. That takes effect only after the
  changed functions are published.
- **Per-record features stay per record.**
  - Contacts (`useJobContacts`) and plan links use the viewed record only.
  - Plain notes added from a merged view are saved to the viewed record. Field-report uploads now
    go to the canonical record (next section).
- **Load cost.** The hub now also loads all CalendarEvents and JobNotes. The job page and workspace
  load the full Jobs list (job page) and read lines and notes once per member record.
- **Customer must match exactly after normalization.** "Pulte" versus "Pulte Home" is treated as a
  different customer, so such pairs are neither merged nor flagged.

## Jobs: new visits attach to the canonical existing Job (added scope)

Date: 2026-09-18. Gabriel's clarified requirement: display grouping is not enough. Every new event,
visit, appointment or field report for an existing customer plus normalized address must attach to
the canonical existing Job record instead of creating a new one. Nothing was committed, pushed,
merged, published or deployed. No production record was queried, merged, edited or deleted. Every
Job record that already exists is left as it is.

### Every path that creates or resolves a Job
| Path | Before | Now |
|---|---|---|
| `fetchCalendarEvents` (calendar → billing lines) | `matchJob` checked PO, then OE, then an address compared with **units stripped** and **no customer check**, then an exact name. Jobs load newest first, so the **newest** duplicate won. Any event with an address and a new name auto-created a job. Within a batch, creates were deduped by exact normalized name only. | `planIngestJobs` (below). Creates at most one job per identity per run. |
| `fetchProbuildPosts` (ProBuild → billing lines) | Name-only `matchJob`, so a spelling change created a job. It also created jobs for posts that already had (append-only) lines, which left orphan jobs. | Same planner. Uses the owner-confirmed `ProbuildProjectLink` as a hard ID, and customer + address parsed from the project name. Existing posts and locked months never create a job. |
| `resolveFieldReport` upload | Filed the note on whatever `job_id` it was given, which could be a duplicate record. | Files the note on the canonical record of that job's group (response includes `job_id`). A doubtful group, or a failed Jobs read, keeps the given record. |
| `windowQuotesCore` `convert_won` | Creates a job per won quote, keyed by `source_window_quote_id`. | **Unchanged.** Won quotes are deliberate new sales, and the Jobs hub already keeps different quotes apart. |
| `YaFees.jsx` "Create job", `ProfitSplitForm` | Manual creates from the UI. | **Unchanged.** `YaFees` is not routed, and `ProfitSplitForm` is only used there. |
| `pushCalendarEvent`, `messages-bridge` `link_job`, `probuild-control` link/report | The user picks an existing job; these never create one. | Unchanged. |

### Rules (`base44/shared/jobIdentity.js`, new; used through `ingestShared.ts`)
- **Identity.** Customer is `builder`, else `customer_name`, else the name before the dash,
  normalized. A legacy builder of just `YA` counts as no customer. The address is the address
  field, else a house-number part of the name. Unit, lot and building are part of the address.
- **Order.**
  1. Hard IDs: the ProBuild project link, then PO, then OE.
  2. Customer + address.
  3. Exact normalized name or alias.
  4. Otherwise a new job, or name-similarity review, as before.
- **Canonical record.** Every match resolves to the **oldest** record (`created_date`, then `id`)
  with the same customer, street and unit, where only a missing street type may differ. This is the
  record the Jobs hub shows as the group head. `src/lib/jobDedupe.js` now imports the same helpers,
  so the two cannot drift. A test checks that they agree.
- **Attach.** Same customer + same street + same unit. A PO or OE on a newer duplicate also lands
  on the canonical record.
- **Separate.** A different unit, lot or building, a different house number, or another customer.
  Builders that share only a generic word ("Ivory Homes" vs "Holmes Homes") count as different
  customers.
- **Flag for review.** No job is attached and none is created; the billing line gets
  `job_id: null` and `needs_review: true`. The response lists each case under `job_match_reviews`
  with a reason and the candidate jobs. The cases:
  - existing duplicates that disagree (Dr vs Ct, or different window quotes);
  - a similar street or a unit on one side only;
  - "Pulte" vs "Pulte Home";
  - an address match whose existing customer is unknown;
  - one address with several customers, when the event has no customer;
  - an address with no house number that another job also uses;
  - the same generic name at a clearly different house;
  - a PO or OE pointing at a different customer or house;
  - PO and OE pointing at different jobs;
  - a near-identical name with no address (the previous rule).
- **Within one batch.** Events are resolved in a fixed order (date, then id). A job to be created is
  added to the index as a pending record, so later events in the same run attach to it (or are
  flagged) exactly as they would against an existing job. A create that cannot be confirmed leaves
  the line unlinked and in review.
- **Existing links are kept.** A calendar line that already has a job keeps it; it is never
  re-pointed to the canonical record. Rows that ingest skips (manually adjusted, billed, app-written,
  locked month) never create a job.
- **Also fixed:** `extractBuilder` ignored an upper-case `YA -` prefix, so "YA - Pulte Home - …"
  got builder `YA`.

### Tests (`base44/tests/jobIngestDedupe.test.mjs`, new, 11 tests)
The published `fetchCalendarEvents`, `fetchProbuildPosts` and `resolveFieldReport` handlers are
bundled with esbuild and run against an in-memory entity store. Only the Base44 SDK and the
ProBuild network client are stubbed. The tests cover:
- **Across spellings.** Every spelling of the Pulte 2154 house resolves to the oldest record, in
  either Jobs order. That includes "Pulte Homes", "YA - …", lower case, a legacy `YA` builder and a
  PO on a newer duplicate.
- **Across runs.** Four calendar visits, then a fifth the next run, all attach to `job-a`. Zero jobs
  are created and the Jobs table is untouched.
- **One batch.** Four visits for a new house (three spellings plus a PO-only warranty call) make one
  `bulkCreate` of one job. A later run attaches to it.
- **Kept separate.** Lot 13 vs Lot 12, Unit 2 vs Unit 1 (also from a ProBuild name with no
  address), Toll Brothers and Ivory Homes at the Pulte address, and 2158. The next lot attaches to
  its own existing job.
- **Fails safe.** Each review reason above: no attach and no create. In the calendar handler,
  ambiguous events create nothing and are listed in `job_match_reviews`. An existing link is not
  re-pointed, and a skipped manual row creates no job.
- **ProBuild.** Two project spellings go to `job-a`, a new project creates one job for three posts,
  and the project link wins. A near-name project is flagged. A second run creates nothing.
- **Field reports.** Notes land on `job-a` from a duplicate `job_id` or from an event. Dr/Ct stays
  put, and a failed Jobs read keeps the given id.
- **Hub agreement.** Ingest and the Jobs hub agree on the canonical record.

### Execution evidence
- **None from me for this addendum.** Every `node` command (Bash and PowerShell) was still behind
  the approval gate, so the new test file, the existing suites, lint and build were **not run** in
  this session. The earlier 123/123, lint and build results predate this change.
- **Checked by hand:**
  - every assertion in the new file, traced through `resolveJob`/`planJobMatches` (for example the
    Dr/Ct candidates `['t1','t2']` and the batch order n1→n4);
  - the existing `tests/jobsDedupeReports.test.mjs` expectations against the moved helpers. The
    only behaviour change there is `firstWord` skipping a leading directional ("100 N Main" →
    `main`), and no existing assertion depends on it.
- **Lint scope.** `eslint.config.js` lints only `src/components` and `src/pages`. No file in this
  addendum is in that scope, so lint cannot cover it; the build does cover the
  `src/lib/jobDedupe.js` → `base44/shared/jobIdentity.js` import.

Run before landing:
```powershell
node --test base44/tests/jobIngestDedupe.test.mjs
node --test tests/jobsDedupeReports.test.mjs tests/hubSweep.test.mjs tests/jobContacts.test.mjs tests/todoBoard.test.mjs tests/todoService.test.mjs tests/todoBundle.test.mjs
node --experimental-loader ./scripts/job-test-ts-loader.mjs --test (Get-ChildItem base44/tests -Filter *.test.mjs).FullName
npx eslint src/pages/JobsHub.jsx src/pages/JobDetail.jsx src/components/jobs
npm run build
```

### Risks and follow-ups
- **Publish together.** Publish `fetchCalendarEvents`, `fetchProbuildPosts` and
  `resolveFieldReport` together, with the new relative import `../../shared/jobIdentity.js`. It
  follows the same `.js` shared-import pattern `ingestShared.ts` already uses. If publishing rejects
  it, bundle it the way `todos` was bundled.
- **More review items at first.** The rules deliberately trade auto-creates for review flags:
  - "Pulte" vs "Pulte Home";
  - a unit on one side only;
  - subdivision- or city-only addresses shared with another job;
  - a generic job name reused at another house.

  How many depends on production data I did not read. Watch `job_match_reviews` on the first runs.
- **Old duplicates remain.** Existing duplicate records are not merged, and existing billing lines
  keep the job they already point at. The Jobs hub still groups them at read time. Re-pointing old
  lines or merging records is a separate, owner-approved data change.
- **Lots without a house number.** "Daybreak Lot 12" vs "Lot 13" with no address still falls back
  to name similarity, which flags review (as before) rather than creating a job.
- **Customer must be recognisable.** An event with no builder and no dash in its name has no
  customer. It attaches on an exact address only when a single customer is at that address;
  otherwise it is flagged.
- **Cost.** `resolveFieldReport` now reads the Jobs list on each upload to find the canonical
  record. Ingest builds one index per run instead of scanning all jobs per event.

## Finance gaps: FeeLine companions, calendar labor ingest, ProBuild service quantities (added scope)

Date: 2026-09-18. Approved addendum on the same branch, after the canonical Job ingest pass (left as it
was: `base44/shared/jobIdentity.js`, the planner and `base44/tests/jobIngestDedupe.test.mjs` are
unchanged). Nothing was committed, pushed, merged, published or deployed. No production record was
read or changed, and no Base44 or MCP data tool was called. The scan figures and record IDs below are
the ones you supplied; they are used as fixture labels and provenance only.

### Root causes (from the code)
1. **$0 ProBuild twins beside the calendar labor line (101 jobs).**
   - `fetchProbuildPosts` merges a post into a calendar line only when that line has **no** notes
     labor (`findCalendarRowToMerge` skips `calendar_labor_amt`). A report posted for a visit whose
     calendar line already carries `Labor $2,232` therefore becomes its own `source: "probuild"` line
     at $0.
   - Nothing correlated the two at read time. Supersession only covers `superseded_by` links and
     same-post duplicates with hours, and the audit's `CalendarEvents.matched_post_ids` was never used
     by billing.
   - The effect: Invoicing and the Jobs view listed the $0 twin as a separate "No charge" line on the
     same job and day as the real labor line, with nothing tying the two together.
   - **Caveat:** in the code, the calendar line's amount was still counted. I found no path where the
     twin *replaced* the calendar line in totals. If the scan saw that on a specific screen, name it
     and I will trace that screen.
2. **Calendar labor that was never billed (10 events, $18,422).**
   - **The parser rejected the notation.** `extractLaborAmount` rejected `Labor$-3168-win` on purpose,
     treating it as an ambiguous minus. It also rejected `Labor$1240win` (a `win` suffix without a
     slash) and read `Labor $3,168.00win` as **$3**.
   - **Some months were never written.** `fetchCalendarEvents` drops **every** event in a month that
     has any `sheet-import` row, or a close snapshot. An event missing from the imported sheet
     therefore never gets a line.
   - **The same parser feeds the calendar.** `CalendarEvents.labor_amt` (`syncGoogleCalendarEvents`)
     uses it too.
3. **ProBuild service reports stored at $0.**
   - The quantity pattern did not accept the crew shorthand "2 man vinyl hours" or "5 man vinyl man
     hour". Those notes fell into "quantity not explicit", which means $0 held for review.
   - Existing ProBuild lines are append-only, so a parser fix alone would never reach lines already
     stored at $0.

### What changed
| Area | Files | Change |
|---|---|---|
| Companion resolver | `base44/shared/billingCore.js` (`feeCompanions`, `eventPostIndex`) | Pure and shared by the browser and the backend. A standalone ProBuild line (`source: "probuild"`, with no calendar event of its own) is paired with calendar lines by **identity** first: the same post merged into the calendar line, or the post the audit matched to that line's event. Only when there is no identity link does it pair by **the same `job_id` within ±3 days**, the ingest merge window. A $0 twin with no open quantity question is **folded**. A priced ProBuild line beside calendar **notes** labor is **held for review**, except when the calendar amount is only a trip charge. Manually adjusted, billed, superseded, duplicate-post and profit-split lines are never folded or held. |
| Presentation | `src/lib/invoicingFilters.js` (`withCompanions`, `buildSupersededSet(rows, events)`, `isMatchBlocked`), `src/pages/Invoicing.jsx`, `Dashboard.jsx`, `YaFeesSidebar.jsx`, `invoicing/LineList.jsx`, `LineRow.jsx`, `LineDetailsDrawer.jsx`, `src/lib/feeUI.js` | Folded twins are excluded like superseded rows. A $0 twin is money-neutral, so the calendar labor line is the one listed and counted, once. Held lines show "Review pricing" with the reason and move to Needs review until someone adjusts them. The drawer on a calendar line says how many $0 ProBuild lines were folded into it. The companion fields are display-only (`_companion_*`) and are computed in a memo. Writes still start from the raw rows, so they are never saved. Invoicing filter counts are now taken over the rows the lists show. |
| Month close | `base44/shared/supersession.ts`, `base44/functions/closeMonthSnapshot/entry.ts` | Same fold and hold as the UI, using CalendarEvents for the audit matches. The population definition says so. |
| Labor$ notation | `billingCore.js` (`extractLaborAmount`, `pricingReview`) | `Labor$-3,168-win` is read as the ticket notation, with the dash as a separator (the mirror of `Labor-$18,000-win`), but **only** with the win suffix. `Labor$-3168` or `Labor $-50 credit` stays ambiguous and goes to review. `win` works with or without a separator. A comma followed by a digit is always a thousands separator. |
| Calendar ingest | `base44/functions/fetchCalendarEvents/entry.ts` | See the calendar ingest rules below. |
| ProBuild quantities | `billingCore.js` (`extractExplicitService`), `base44/functions/fetchProbuildPosts/entry.ts` (`serviceFill`) | See the ProBuild quantity rules below. |

**Calendar ingest rules (`fetchCalendarEvents`)**
- **Upserts.** Upserts on the event id are unchanged, so a $0 line whose notes now read, such as the
  Landscope 178 Mayflower line, is updated to its amount.
- **A recorded amount is never replaced with nothing.** When the notes no longer show a readable
  amount, the old amount is kept and the line is held for review.
- **Notes labor on a merged line.** Notes labor that newly appears on a line already merged with
  ProBuild hours gets the existing allocation-review hold.
- **A priced ProBuild line may already carry the labor.** A new calendar labor line is held when a
  manually adjusted or billed ProBuild line on the same job, within ±3 days or matched by the audit,
  may already include it.
- **Locked months.** Existing rows are still never rewritten. The one exception is in a
  sheet-imported month that is not closed: an event with notes labor and **no line at all** gets a
  new calendar line, **held for review**.
  - Such an event is skipped and reported when any non-calendar line on that job (for example the
    sheet row) is within ±3 days.
  - These fills never create a Job and never reverse-merge.
- **Closed months** are never written. The response lists every gap in `locked_month_labor_gaps`
  with a reason:
  - `month_closed`;
  - `existing_line_nearby` (with `covered_by`);
  - `locked_line_without_labor`, a locked $0 line whose notes now read as labor.

**ProBuild quantity rules (`extractExplicitService`, `serviceFill`)**
- **The crew shorthand is read.** "N man \<material\> hours" and "N man \<material\> man hour(s)" are
  now quantities, priced at the configured rates: vinyl $100, composite $125, wood $150 per man-hour.
- **Ambiguity stays in review.** A missing or written-out number, two quantities, two materials, no
  material, or no-charge wording is never guessed.
- **Additive fill of existing lines.** An existing ProBuild line gets the explicit quantity and rate
  only when all of these hold:
  - it is untouched: not manually adjusted, billed or superseded, not merged into a calendar line,
    and not in a locked month;
  - it has no quantity yet and computes to $0;
  - its note now reads as one explicit quantity and one material.

  The response lists these under `service_quantity_filled`.

### Behaviour changes to confirm
- **Priced ProBuild lines can now be held.** A line that sits within 3 days of a calendar line with
  notes labor on the same job now waits in **Needs review** instead of counting as Ready. This is the
  double-count guard. A trip-charge-only calendar amount does not hold it. The first Edit (manual
  adjustment) releases it. How many lines this holds depends on production data I did not read.
- **"Labor$-N-win" is now billable.** It was held as ambiguous before. The earlier test asserting
  that was updated (`tests/month-billing-repair.test.mjs`).
- **Two exceptions to the append-only ProBuild rule (Gabriel, 2026-09-15).** The explicit-quantity
  fill above, and new calendar lines in sheet-imported months, which are held for review.
- **Unlinked twins fold only through the audit.** A $0 twin with no `job_id` is folded only through
  the audit's matched posts or a shared post id. Without that link it stays visible, as before.

### Tests
**`tests/financeCompanions.test.mjs` (new)**
- **Service extraction:**
  - "2 man vinyl hours" gives $200, and "5 man vinyl man hour" gives $500 (FeeLines
    `6aaa44df2f4c4298172393f1` and `6aa8e96cf314c5e896fd5366`);
  - the composite and wood shapes and rates;
  - the ambiguous shapes stay in review.
- **Labor$ shapes:** every missing-event amount, the `$3,168.00win` fix, and a stray minus still
  going to review.
- **Companions:** all eight paired fixtures, which cover:
  - job + date pairs (`6aa4d305…` → `6aacdc98…a9`, $2,232 Patterson 4 Belmont, and the rest);
  - post identity (Cadence 151 Beacon, with the twin on a duplicate job record);
  - audit event identity (Landscope 178 service → `6aa256c5…a6`, which has no job link);
  - the Landscope Lakeview 177 pair of twins, one of them equidistant (folded, no owner).

  Only the 8 calendar lines are listed, and ready is **$884.60** = 10% of $8,846.
- **Agreement:** Dashboard, sidebar, statement export and a dry-run `closeMonthSnapshot` (bundled
  and run in memory) give the same totals.
- **Holds and preservation:**
  - a priced line beside calendar notes labor is held (only $100 ready, $20 in review), then released
    by a manual adjustment ($120), and month close agrees;
  - a trip-charge calendar amount and a merged-hours calendar line do not hold anything;
  - manual, billed, open-question, far-dated, other-job and $0-calendar cases are never folded.

**`base44/tests/financeGapIngest.test.mjs` (new; published handlers bundled with esbuild, in memory)**
- **All ten missing events.** Each of the ten missing CalendarEvents (`6a8164447a2945240aaa8f4e` …
  `6aa256b0cb0052a931d701e3`) gets exactly one calendar line with its labor, **$18,422** in total. A
  rerun is idempotent.
- **Locked months:**
  - the closed April event is reported, not written;
  - the Holmes 305 Lakeview pair is skipped beside a sheet row and reported with `covered_by`;
  - the other July events are created and held;
  - the sheet row is untouched, and a rerun leaves the locked month alone.
- **Upserts and guards:**
  - the $0 Landscope 178 line is upserted to $3,168;
  - manual, billed and app lines are untouched;
  - a recorded $2,232 whose notes lost the amount is kept and held.
- **Beside a manual ProBuild line.** A new labor line next to a manually priced ProBuild line on the
  job is held, and the manual line is untouched.
- **ProBuild fill:**
  - the two $0 fixtures are filled to $200 and $500, and their job links are kept;
  - manual, billed, locked-month, already-priced and ambiguous lines are unchanged;
  - a new "3 man composite hours" post is priced at $375;
  - a rerun changes nothing.

**Unchanged:** `base44/tests/jobIngestDedupe.test.mjs` needs no change. Its notes carry no labor or
hours and it has no locked months, so none of the new paths run.

### Execution evidence
- **None from me.** Every `node`, `npm` and `npx` command was still behind the approval gate, in
  both Bash and PowerShell, including the two new suites. The tests, lint and build for this
  addendum have **not been run**. The earlier 11/11 and 72/72 test results and the build you reported
  predate it.
- **Checked by hand:**
  - every assertion in both new files, traced through the code. For example: the ±3-day window drops
    `…9a` for twin `…94`, so its owner is `…a8`; twin `…95` sits 2 days from both calendar lines, so
    its owner is `null`; the ready sum is 223.20 + 7.50 + 150.30 + 129.30 + 7.50 + 316.80 + 25 + 25 =
    884.60; and the job matches for every fixture name go through `resolveJob`.
  - regex behaviour for each Labor$ and man-hour shape;
  - that `tests/hubSweep.test.mjs` fixtures have no calendar event, so no companion logic applies to
    them.

Run before landing:
```powershell
node --test tests/financeCompanions.test.mjs tests/month-billing-repair.test.mjs tests/hubSweep.test.mjs tests/jobsDedupeReports.test.mjs
node --test base44/tests/financeGapIngest.test.mjs base44/tests/jobIngestDedupe.test.mjs
npx eslint src/pages/Invoicing.jsx src/pages/Dashboard.jsx src/components/YaFeesSidebar.jsx src/components/invoicing
npm run build
```
`tests/month-billing-repair.test.mjs` also has older handler tests. They may belong to the
pre-existing root failures you reported, so compare any failure there with `main` before
attributing it to this change.

### Risks and follow-ups
- **Publish together.** Publish `fetchCalendarEvents`, `fetchProbuildPosts` and
  `closeMonthSnapshot` with the frontend, so the month snapshot and Invoicing keep agreeing.
  `syncGoogleCalendarEvents` picks up the parser fix for `CalendarEvents.labor_amt` on its next
  publish.
- **The event texts are representative.** I did not read the real descriptions of the ten events.
  If one of them uses another shape, it stays unbilled and needs one more pattern. After the first
  refresh, check `locked_month_labor_gaps` and each event's line.
- **Months must be refreshed.** Fills happen only when those months are refreshed. The default run
  covers the current month only, so use Invoicing → Refresh for April–August.
  - **April** (and any other closed month) is never written. Its gaps are listed for a manual
    decision.
- **Existing twins stay in the data.** They are hidden at read time only. No row is deleted, merged
  or re-linked.
- **The Jobs hub and job pages still count raw review flags.** They don't apply the hold, so a job
  whose only issue is a held companion line reads "Complete" there while Invoicing shows it in
  review.

## Jobs and Calendar usability pass (2026-09-25)

Frontend only. No entity, function or data changes; nothing published.

**Jobs hub** (`JobsHub.jsx`, `JobBrowserRow.jsx`, `src/lib/jobsOverview.js`)
- Each job shows its **next visit** (Today / Tomorrow / date) or, when nothing is scheduled, its **last visit**. Dates come from linked calendar events and billing lines; cancelled calendar placeholders are ignored.
- New **Visits this week** pill (next visit within 7 days, Denver days).
- **Sort**: Newest added (default, unchanged), Next visit, Last visit, Name A–Z. **Builder filter** with counts.
- Search, view, sort and builder are kept in the URL (`?q=&show=&sort=&builder=`), so Back and shared links keep them. **Clear filters** resets them.
- Rows: status chip with dot, builder · address on one line; tablet shows two columns.

**Calendar** (`CalendarPage.jsx`, new `EventCard.jsx`, `WeekView.jsx`, `AgendaList.jsx`, `src/lib/calendarModel.js`; `MonthGrid.jsx`, `EventBubble.jsx` colours)
- One header: period title with visit count, prev/Today/next, Month · **Week** · List, New event.
- **Week view** (Sun–Sat, crosses month boundaries; arrows move by week).
- **List view** is a day-by-day agenda with Today/Tomorrow headings, scrolled to today.
- Filter chips with counts replace "Unreported only": All, Installs, Service, Outlook (when present), Needs report.
- Visit cards show time range, address, crew, a report chip ("Needs photos · 2d late", "Reported", …) and an Open job link when the event is linked.
- Admin tools (Installation calendar, iPad schedules, Find a job update) sit in one row and open with a consistent back bar.
- **Behaviour changes to confirm**
  - Install vs service now uses the Invoicing wording rule (`service|warranty|wty|warr|per report` in the title or scope = service). Before, every Google-synced event counted as service, so installs were red and the Installs count was 0.
  - Future visits are no longer flagged as missing a report (their `report_status` defaults to `pending`). The needs-report flag is amber, not red, so it stays visible on service events.

**Tests**: new `tests/jobsHubVisits.test.mjs` (5) and `tests/calendarModel.test.mjs` (6) pass. Full root suite: 459 pass, 12 fail — the same 12 failures as before this change (ownedCalendar handler, install budget, jobProfitability, ProBuild refresh). Lint clean on touched files; `npm run build` passes.

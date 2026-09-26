# Job handoff (Stage 2 → Milan) — design

Gabe sells a job, orders it, gets the ETA, files the plans and notes. Today he then texts
Milan. The Hub should carry that moment instead: a gated checklist on the job page, a note,
and one **Submit to Milan** that flips the job's stage and puts everything Milan needs on his
to-do board and calendar.

## Stages on a job

`Jobs.stage` (new enum): `quoted` → `sold` → `ordered` → `handed_off` → `scheduled` → `installed` → `closed`.
Optional `Jobs.pm_member_key` (TeamMember.member_key of who runs the job after handoff).
The job hero gets a small stage chip with a picker (owner / manager); the handoff sets
`handed_off` + `pm_member_key` itself. Nothing else in the Hub changes stage automatically yet
(scheduling/install/close automation is a later pass).

## The handoff record

New entity `JobHandoffs` — one live record per job:

| field | notes |
|---|---|
| `job_id` | Jobs id |
| `status` | `draft` → `submitted` (later `started` / `done` when Milan moves it) |
| `to_member_key` / `to_member_id` | who gets it (default: the active TeamMember whose name starts with Milan; picker) |
| `from_email` / `from_name` | who submitted |
| `start_date` | YYYY-MM-DD — the day the PM should jump on it |
| `eta_date` | vendor ETA (typed, prefilled from the job budget / vendor order when present) |
| `notes` | Gabe's note to the PM |
| `checklist` | `[{ key, label, required, done, kind: auto|check|upload|date, value, file_url, file_name, auto_ok, auto_detail }]` |
| `todo_id`, `calendar_event_id` | what submit created |
| `submitted_at`, `handoff_summary` | summary text as it was sent |

RLS: admin + manager read/write via the backend function only (service role); crews never see it.

## Checklist (v1, fixed list; per-item file uploads go to Base44 storage)

| key | label | kind | how it passes |
|---|---|---|---|
| `po` | Order placed — PO on the job | auto + check | a PO number on `Jobs.po_numbers` (or typed here, which also saves to the job) |
| `eta` | Vendor ETA | date | a date; prefilled from JobBudgets.glass_eta_date / VendorOrders.eta_date |
| `plans` | Architectural plans | upload or folder | a PDF attached here **or** the job's Drive folder linked (OneDrive link field accepted too) |
| `order_doc` | Order confirmation / vendor quote | upload | a file attached here, or a JobBudgets row with a quote PDF on this job |
| `contacts` | Super + homeowner on file | auto | super saved on the job (homeowner optional, shows as a warning) |
| `scope` | Scope notes written | check | the box, plus the Scope card not empty |

Every required item must pass before **Submit to Milan** enables. Drafts save as you go, so
the checklist can be filled over days. A missing optional item travels in the note.

## What submit does (one backend call, `jobHandoff` action `submit`)

1. Validates the checklist; refuses with the list of what is missing.
2. `Jobs.update`: `stage: handed_off`, `pm_member_key`, `handoff_id`.
3. Builds the **handoff summary** — the job tab, packaged: builder, address, super + phone,
   homeowner + phone, PO / OE, ETA, folder link, attached files, scope, Gabe's note, Open-job link.
4. Creates ONE `TodoTask` on the PM's board, lane `follow_up`, due `start_date`, title
   `New project: <job> — starts <date> · from <name>`, details = summary
   (`request_key = handoff:<job_id>` keeps it idempotent; re-submitting updates, never duplicates).
5. Creates ONE Hub-owned `CalendarEvents` row on `start_date`: `Kickoff: <job> (<PM>)`, source
   `app`, synthetic `google_event_id = gfjobs-handoff-<job_id>`, `job_id` linked, all-day, no
   labor amount. It shows on the Calendar page and the Today run sheet; it is **not** pushed to
   Google (that can be added once we know which calendar the PM lives in).
6. Writes a `JobNotes` row (`interaction_type: handoff`) so the job's activity feed shows
   "Handed off to Milan · starts Oct 6".
7. Marks the handoff `submitted`.

If the ETA changes later (edit on the handoff card), the to-do's due date, the kickoff event
and the summary update in place, and the job note logs "ETA moved".

## UI

- Job page (owner / manager): a **Handoff** card below "Cost & sell". Before submit it is the
  checklist + start date + note + Submit button. After submit it becomes the **Stage 2 banner**:
  "In Milan's hands · submitted by Gabe Sep 26 · starts Oct 6", the summary, and an Edit
  (ETA / start date / note) control.
- Job hero: stage chip (`Stage 2 · Milan`) with a picker for the owner / managers.
- To-do board: the card lands in the PM's Follow-ups lane like any task — no board changes.
- Milan's future My Day page reads `JobHandoffs` where `to_member_key = milan`, sorted by
  `start_date` (out of scope here; this spec only makes the data exist).

## Access

Owner and managers can run a handoff. Crews (`user` role) see neither the card nor the
stage picker; the stage chip is visible to everyone.

## Tests

Pure module `base44/shared/jobHandoff.js`: checklist evaluation (auto items from job facts),
readiness, summary text, to-do / event payloads, idempotent request keys — Node tests.
Backend function `jobHandoff` wires it (get / save_draft / upload item / submit / update_after).

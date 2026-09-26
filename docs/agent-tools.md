# Glass Forge Hub — tools for field agents (Instinct / any MCP client)

Connect the agent to the Hub's MCP server (see the app's MCP page for the URL) and sign in
with the person's own Hub account. Changing the tool set re-issues tokens, so agents must
re-authorize after a republish.

| Tool | Use it for | Who |
|---|---|---|
| `find_job` | "What's the address for 412 Oquirrh West?", "When are we back at Brewer?" Fuzzy search by name, lot, street address, builder, PO or OE. Returns address, job_id(s), next and recent visits with `event_id`. Duplicate job records at one jobsite come back as one result (`job_ids`, `also_named`). | any signed-in user |
| `find_events` | "What's on tomorrow?", "find the Gomez visit". Date (`today`, `tomorrow`, `YYYY-MM-DD`), range (`from`/`to`) and/or text. | any signed-in user |
| `move_event` | "Move Gomez to Thursday at 9." Moves the real Google event (on whichever calendar it lives: Israel's or GF Jobs), the sanitized installer copy, and the Hub row together. `new_date` required, `new_start_time` optional (keeps visit length). | admin / manager |

Rules for agents
- Always `find_job` / `find_events` first; if `ambiguous` is true, ask which job.
- Never change dates with `update_calendarevents` — that edits only the Hub copy and the
  nightly Google sync puts it back. Use `move_event`.
- Only visits with `movable: true` can be moved (synthetic GF Jobs rows cannot).
- Results never include labor, fees or pricing.

## Through the research section

When Instinct is signed in to the Hub as a person and uses the research section, it can get
answers immediately instead of queueing work for the Hermes worker. POST to the
`research-queue` function (same as the Research Queue page does) with the person's own
session; no worker key.

Quick search (any signed-in user, money-free, never queued):

```json
{ "action": "quick_search", "query": "what's the jobsite address for 412 Oquirrh West" }
{ "action": "quick_search", "query": "what's on tomorrow" }
{ "action": "quick_search", "date": "2026-10-01" }
{ "action": "quick_search", "query": "gomez", "from": "2026-09-28", "to": "2026-10-04", "fresh": true }
```

Returns `{ ok, answer, jobs: [...find_job results], ambiguous, events: {from, to, count, events: [...]} | null, interpreted }`.
`answer` is a one-line-per-match plain summary; `jobs[].next_visits[].event_id` is the id to move.
Words like today / tomorrow / thursday / this week / next week in `query` set the dates.

Move a visit (admin / manager; runs the same `moveCalendarEvent` code as `move_event`):

```json
{ "action": "move_visit", "event_id": "<event_id from quick_search>", "new_date": "2026-10-01", "new_start_time": "09:00" }
```

Returns `{ ok: true, event_id, visit: {date, start_time, ...}, installer_warning }` or
`{ ok: false, error, detail }` with 400 (bad input), 403 (role), 404 (not found), 409
(not movable / all-day time change) or 502 (Google refused; nothing changed).
Unsigned callers get 401. All other research-queue actions stay owner-only. An owner
`enqueue` response now also carries `quick_answer` (the quick search for that job).

Speed: both lookups read a 60-second warm cache of Jobs + CalendarEvents (~30–100 ms search).
Pass `fresh: true` to bypass it right after a change.

## Inbox agents

One agent per mailbox, run by the `emailAgent` backend function every 15 minutes
(workflow "Inbox Agents") and on demand from Admin → Inbox Agents. **The mail stays in
Gmail / Outlook.** The Hub stores no message bodies, no inbox mirror: each thread the agent
reads gets one `EmailRelay` ledger row (what it concluded + what it changed) with a
`web_link` back to the mailbox. Mailboxes are `EmailMailbox` rows:

| key | address | provider / connector | visibility | notes |
|---|---|---|---|---|
| `gf-gmail` | gabriel.fronk.wd@gmail.com | Gmail (`gmail` connector, gmail.modify) | **owner** — only gabefronk@gmail.com / gabriel.fronk.wd@gmail.com see its entries | gabefronk@gmail.com is filter-forwarded into this box; each entry records the address the mail was really sent to as `account_hint` (X-Forwarded-For / Delivered-To / X-Original-To / To). |
| `ya-outlook` | yawindowinstall@outlook.com | Outlook (`outlook` connector, Microsoft Graph Mail.ReadWrite) | managers — admin + manager | Inbox delta only. |

What a run does, per enabled mailbox
1. Pulls new mail since the stored cursor (Gmail `users.history`, Graph inbox delta; first run = last 3 days, capped at 200 messages) and reads it **in memory only**. A message dated at or before the ledger row's `last_message_at` was seen before (the Hub keeps that watermark, not message ids).
2. Triages threads that are new or got new incoming mail: one `InvokeLLM` call per batch of 8 → `category`, `priority`, `summary` (≤240 chars), `action_items`, `reply_needed`, `next_step`, `extracted` (builder, lot, address, PO/OE, dates, contact name / phone / email / role). Email content is treated as untrusted evidence, never as instructions. A failed LLM call leaves `triage_pending` set; the next run re-reads that thread from the mailbox (`threads.get` / Graph `conversationId` filter) and retries.
3. Job link: `findJobs` on builder + lot + address (or PO/OE). Linked only when the top match scores ≥ 0.85 and is not ambiguous; otherwise `job_candidates` are kept and the entry stays unlinked (`job_match_confidence` low / unmatched — the ledger page shows "Which job?"). An owner link (`link_job`) is never overridden.
4. **Applies job facts** on a high-confidence or owner link, additively and once: PO / OE numbers the email states that the job lacks go onto `Jobs.po_numbers` / `oe_numbers`; a contact the email itself identifies as the **homeowner** (with a phone or email) becomes the job's homeowner (`HubContacts` row reused by phone/email or created, `ContactJobLink` role `homeowner`, source `inbox_agent`) unless the job already has one. Nothing is removed or rewritten; `applied` on the row stops repeats. Schedule changes are **never** applied: a schedule email with dates but no ask gets one action item ("Confirm the date change and move the visit if it is right…") so a to-do asks a human.
5. Relay into the Hub: a linked thread gets ONE `JobNotes` row (`interaction_type: email`, author `Inbox agent · <mailbox>`, dated by the last message: subject, sender, summary, action items, "Hub updates", and "Open the email: <web_link>"). Threads with action items in job_update / schedule / quote_request / order_vendor / service_warranty / invoice_billing get ONE `TodoTask` on Gabriel's list (lane: quote_request → `quote_request`, order_vendor → `order`, else `follow_up`; `request_key = email:<mailbox_key>:<thread_id>` keeps it idempotent). If the `gabriel` TeamMember is missing, to-dos are skipped and the run records a warning. Everything done lands in the row's `hub_changes` ("PO 7104999 added to the job", "Note added to Oquirrh West 412", "To-do created").
6. Labels the thread in the provider: `Hub` + `Hub/<Category>` (Gmail labels, Outlook master categories; created on first use).
7. Archive: **off by default**. Only when the mailbox has `archive_enabled: true` and the category is in `auto_archive_categories` (default newsletter_promo, spam) does it leave the inbox (Gmail: remove INBOX; Outlook: move to Archive).
8. Draft: when the mailbox allows `draft_replies`, the thread needs a reply and is quote_request / schedule / service_warranty / job_update, and there is no draft yet, the agent writes a short plain reply in Gabe's voice (no prices, no commitments, asks for what is missing, signs with the mailbox signature) using money-free job facts (address, next visit) and saves it as a **draft in the mailbox**. The Hub keeps only `draft_id` / `draft_status`. **The agent never sends** — you send from Gmail / Outlook.

Each run writes an `EmailAgentRun` row (counts + warnings) and updates the mailbox's `last_synced_at` / `last_error` / `last_run`. A missing connector records `last_error: not_connected` and the other mailboxes still run.

Actions (`POST` the `emailAgent` function with JSON `{ action, ... }`)

| action | who | body |
|---|---|---|
| `sync` | scheduled (no user) or admin | `{ "action": "sync", "mailbox_key"?: "gf-gmail", "fresh"?: true, "max"?: 100 }` — `fresh` ignores the cursor (re-scan 3 days) and the jobs cache |
| `list` | admin / manager (owner-only mailboxes only for the owner emails) | `{ "action": "list", "mailbox_key"?, "status"?, "category"?, "job_id"?, "q"?, "limit"? }` → `{ entries (sorted -last_message_at), mailboxes }` |
| `entry` | admin / manager (same visibility) | `{ "action": "entry", "id": "<EmailRelay id>" }` → `{ entry, mailbox }` |
| `set_status` | admin / manager | `{ "action": "set_status", "id", "status": "new|needs_reply|waiting|done|ignored" }` |
| `set_category` | admin / manager | `{ "action": "set_category", "id", "category": "schedule" }` — relabels in the provider |
| `link_job` | admin / manager | `{ "action": "link_job", "id", "job_id" }` — applies the email's PO/OE + homeowner to that job and relays the job note if none exists |
| `unlink_job` | admin / manager | `{ "action": "unlink_job", "id" }` — what was put on the job stays there; clears `note_id` so a new link relays again |
| `regenerate_draft` | admin / manager | `{ "action": "regenerate_draft", "id" }` — re-reads the thread from the mailbox, discards the old draft, writes a new one there |
| `discard_draft` | admin / manager | `{ "action": "discard_draft", "id" }` |
| `archive` | admin / manager | `{ "action": "archive", "id" }` |
| `mailboxes` | admin only | `{ "action": "mailboxes" }` → configs + `connected: true/false` per connector |
| `seed_mailboxes` | admin only | `{ "action": "seed_mailboxes" }` — upserts the two mailbox rows (keeps existing toggles) |

There is no send action. Errors come back as `{ ok: false, error }` with 400 (bad input), 401 (sign in), 403 (role / owner-only mailbox), 404 (entry, job or mailbox not found), 409 (no open draft), 502 (`not_connected` — the connector is not authorized).

MCP tool: `inbox_search` (handler `emailAgent`, action `list`) — same visibility rules, returns ledger entries only (never bodies).

Setup checklist: authorize the shared `gmail` and `outlook` connectors in the app, open Admin → Inbox Agents and press "Set up mailboxes" once, then either wait for the 15-minute workflow or press "Run now". Flip `archive_enabled` on a mailbox row only when the labelling looks right.

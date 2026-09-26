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

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

Speed: both lookups read a 60-second warm cache of Jobs + CalendarEvents (~30–100 ms search).
Pass `fresh: true` to bypass it right after a change.

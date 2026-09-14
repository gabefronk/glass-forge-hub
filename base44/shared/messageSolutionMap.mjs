// Reusable planning guidance only; no customer records, source values, URLs or actions.
export const MESSAGE_SOLUTION_MAP_VERSION = 'solution-map-2026-09-14-v3';
export const MESSAGE_SOLUTION_MAP = Object.freeze([
  {
    "id": "homeowner_referral",
    "title": "Homeowner referral",
    "trigger": "A work contact sends a homeowner card, contact details or a lot reference without a clear request.",
    "evidence": "Matched sender; exact builder/community/lot; readable contact fields; relevant job history; separate owner phone-call notes.",
    "draft_step": "Prepare a concise owner question about what happened and summarize the known job context. Keep external acknowledgment brief if appropriate.",
    "owner_review": "Unparsed contact card, unknown purpose, ambiguous job or contact fields. Do not borrow a complaint from another lot.",
    "completion": "Owner context is attached to the right job and the intended next step is confirmed.",
    "current_support": "Context summaries and owner-review notes. Contact-card parsing and proactive private texting are not connected."
  },
  {
    "id": "service_issue",
    "title": "Service issue or repeat problem",
    "trigger": "A door or window is damaged, sticking, leaking, not locking, or a prior repair did not resolve the issue.",
    "evidence": "Current incoming request; exact job and affected opening; each symptom; original photos and prior service history when available.",
    "draft_step": "Preserve every reported issue, distinguish a new issue from a repeat, and prepare a short acknowledgment plus a detailed internal service handoff.",
    "owner_review": "Conflicting lots, missing opening identity, unviewed photos, safety concern, warranty/cost decision or disputed responsibility. Money, warranty disputes and upset customers go directly to Gabe, not the service group.",
    "completion": "A verified dispatch is followed separately by scheduling and a technician report; an acknowledgment is not completion.",
    "current_support": "Saved drafts, photo references, duplicate-acknowledgment checks and conservative Gabe-review holds. No visual inspection, diagnosis, warranty decision or dispatch."
  },
  {
    "id": "replacement_parts",
    "title": "Missing or replacement parts",
    "trigger": "Balances, handles, locks, trim, screens, glass or other parts are missing, broken or on backorder.",
    "evidence": "Exact opening/product/series and quantity; observed defect; original quote/order line; confirmed replacement order and dated ETA.",
    "draft_step": "List the exact missing part and distinguish requested, ordered, backordered, received and installed states. Ask only for the evidence still needed.",
    "owner_review": "Unknown part identity, incompatible product, quantity mismatch, unverified order or an unsupported arrival promise.",
    "completion": "Correct part identity, order/receipt evidence and installation outcome are verified separately.",
    "current_support": "Reported-part summaries and supplied arrival facts. Part/SKU lookup, inventory, purchasing and supplier contact are not connected."
  },
  {
    "id": "arrival_status",
    "title": "Product arrival or delay",
    "trigger": "Someone asks when products or replacement items will arrive, whether they are in, or why delivery slipped.",
    "evidence": "Exact job plus order/line; latest dated sales-sheet/vendor evidence; estimated versus confirmed date; receipt evidence for anything said to be here.",
    "draft_step": "Use current supported dates with their uncertainty. Separate initial product orders from later service orders and disclose stale or missing status.",
    "owner_review": "Conflicting dates, stale source, unlinked order line, past ETA without receipt evidence or a promised date unsupported by the source.",
    "completion": "A current order-specific update or actual receipt is recorded with its source timestamp.",
    "current_support": "Fresh typed arrival facts for the linked job. Live supplier inquiries and warehouse receipt checks are not connected."
  },
  {
    "id": "scheduling",
    "title": "Schedule, reschedule or status",
    "trigger": "A customer or installer asks when work is scheduled, requests a change or asks whether a crew is coming.",
    "evidence": "Exact job and event; current date/time/timezone; assigned crew; event status; proposed versus confirmed occurrence; customer constraints.",
    "draft_step": "Summarize a verified schedule or prepare the requested change for review. Distinguish an invitation from acceptance and a past event from completed work. A crew arrival estimate is separate from a material delivery estimate; historical ETAs are not current facts.",
    "owner_review": "No confirmed event, conflicting crews, cancellation, stale date, new appointment commitment or required homeowner coordination.",
    "completion": "The confirmed event and affected parties agree on the schedule; arrival and completion remain separate facts.",
    "current_support": "Fresh typed installation/service event facts. Availability search, booking, calendar changes and appointment notifications are not connected."
  },
  {
    "id": "pickup_return",
    "title": "Pickup, leftovers or returns",
    "trigger": "A contact asks to collect leftover windows, doors or materials, arrange a return, or follows up on a missed pickup.",
    "evidence": "Exact job/site and items; quantity/condition; ownership and pickup arrangement; latest follow-up; actual collection receipt if claimed complete.",
    "draft_step": "Summarize what needs collecting and the unresolved pickup status. Keep any promised date separate from confirmed logistics.",
    "owner_review": "Repeated unfulfilled promise, unknown items or responsibility, missing location, fees or unverified pickup completion.",
    "completion": "Collection is confirmed for the correct items and location, with return/credit handled separately if needed.",
    "current_support": "Conversation-based summaries and draft follow-up. Dispatch, return authorization and credit handling are not connected."
  },
  {
    "id": "documents",
    "title": "Construction plans or other documents",
    "trigger": "An installer or work contact asks for plans, a drawing, engineering letter, quote or job document.",
    "evidence": "Exact sender and job; current calendar assignment when applicable; verified live folder; correct document and lot coverage; recipient; file and revision evidence. For technical clarification, verify the exact page/revision and the responsible qualified reviewer.",
    "draft_step": "Use the mandatory iPad > MacBook path for existing native Outlook and OneDrive sessions. No direct Microsoft connector, Graph request, browser login or new OAuth connection is permitted. Identify the requested document and any missing retrieval step. For plans, follow the owner's preferred PDF attachment workflow through the existing approved native Outlook session on the wired iPad after verification. For downloaded PDFs use Other Locations > iCloud Drive & Device > On My iPad. Do not initiate a new Microsoft login. Receiving a letter or image does not establish its contents or engineering approval.",
    "owner_review": "Wrong or grouped lot coverage, unverified document/revision, missing recipient, unavailable approved session, oversized attachment or uncertain send result. Structural interpretation or requested technical approval needs the qualified reviewer.",
    "completion": "The exact file is accepted as an attachment and the intended message is verified sent; recipient arrival is a separate check.",
    "current_support": "Document-request guidance only. Automatic retrieval, local iPad control, Outlook attachment handling and sending are not connected to this draft worker."
  },
  {
    "id": "quote_order_change",
    "title": "Quote, order or product mismatch",
    "trigger": "A requested opening, layout, product, quantity or price differs from the quote/order, or a new quote/change is requested.",
    "evidence": "Exact quote revision, plan page and opening; order status; requested change; verified pricing source and owner approval where required.",
    "draft_step": "Compare only supplied facts, separate requested/quoted/ordered items, and prepare a concise clarification or change summary without changing the quote.",
    "owner_review": "Pricing, substitutions, dimensions, quantity discrepancy, unverified plan interpretation, cancellation or an order commitment.",
    "completion": "A reviewed revision/change and any necessary order acknowledgment are recorded; a request alone changes nothing.",
    "current_support": "Scoped summaries and clarifying drafts. Pricing verification and actual quote/order changes use separate reviewed workflows."
  },
  {
    "id": "site_readiness",
    "title": "Site readiness and trade coordination",
    "trigger": "Work depends on framing corrections, another trade, access, customer availability or installer sequencing.",
    "evidence": "Exact job and dependency; current installer/calendar notes; responsible party; any verified readiness update; only necessary authorized access details.",
    "draft_step": "Name the specific dependency and responsible team, preserve chronology, and prepare the next coordination question without assigning blame or inventing readiness.",
    "owner_review": "Conflicting trade reports, blocked access, schedule/cost consequences, unsafe conditions or unclear owner responsibility.",
    "completion": "The dependency is independently confirmed resolved before work is rescheduled or described as ready.",
    "current_support": "Supplied note summaries and scheduling facts. Site checks, trade dispatch and access coordination are not connected."
  },
  {
    "id": "completion_followup",
    "title": "Completion, photos or unresolved follow-up",
    "trigger": "A message says work is done, supplies photos, asks whether a task was completed, or reports an issue after a prior visit.",
    "evidence": "Exact job/task; technician/customer report and date; relevant original photos; open items; separate delivery/install/service events.",
    "draft_step": "Attribute completion to its source, distinguish partial work from full resolution and list unresolved items. Do not treat a reaction or acknowledgment as proof.",
    "owner_review": "No completion evidence, unreviewed images, contradictory reports, repeated failure, invoice/credit decision or requested closure.",
    "completion": "Verified outcome and remaining items are recorded for the right job; closure and customer confirmation are explicit.",
    "current_support": "Evidence summaries and owner-review notes. Visual inspection, automatic job closure and customer/team follow-up sends are not connected."
  },
  {
    "id": "temporary_coverage",
    "title": "Temporary superintendent coverage",
    "trigger": "A work contact is away and names alternate contacts for a limited period.",
    "evidence": "Verified sender and alternate roles; exact job scope; effective and return dates with timezone; owner-approved routing and current conversation participants.",
    "draft_step": "Summarize the temporary coverage for owner review and check whether it is still active. An incoming message does not authorize changing recipients.",
    "owner_review": "Expired or ambiguous dates, unmatched alternate contacts, permanent reassignment assumptions or any recipient outside the bound conversation.",
    "completion": "The owner verifies the effective and expiry dates of a routing record. Expired coverage stops applying; later coordination is a separate action.",
    "current_support": "Draft summaries only. Automated contact reassignment, recipient changes and private messaging are not connected."
  },
  {
    "id": "day_before_confirmation",
    "title": "Day-before appointment confirmation",
    "trigger": "A confirmation is being prepared on the day before an appointment.",
    "evidence": "Fresh confirmed appointment, exact job and recipient, time and timezone, and explicit current cancellation check. Tomorrow is a local calendar date, not a fixed 24-hour offset.",
    "draft_step": "Prepare a brief confirmation for owner review only after every required appointment field is verified. Give plain access or preparation steps only when supplied.",
    "owner_review": "Missing structured appointment evidence, stale capture, ambiguous recipient or lot, cancellation uncertainty, reschedule or new commitment.",
    "completion": "Gabe reviews the draft and handles the external communication separately. A preview is not a sent confirmation.",
    "current_support": "Conservative preflight hold and a tested date/identity validator. The current reply endpoint does not supply the required structured appointment, so this workflow remains held. No reminder scheduler or sends."
  },
  {
    "id": "photo_update",
    "title": "Customer photo update",
    "trigger": "A customer needs progress photos or a short visual update.",
    "evidence": "Actual job-specific photos, exact source references and dates, authorized recipients, and verified or attributed progress notes.",
    "draft_step": "Prepare a plain next-step update after Gabe reviews the photos. Do not infer image contents, repairs, diagnosis or completion from attachment names.",
    "owner_review": "Wrong job or lot, unviewed image, missing import, sensitive access detail or unsupported completion claim.",
    "completion": "Reviewed draft and verified attachments are ready; delivery remains separate.",
    "current_support": "Photo references and an explicit photo-update hold. The draft worker cannot visually inspect or send the photos."
  },
  {
    "id": "gabe_escalation",
    "title": "Money, warranty or upset customer",
    "trigger": "Money, pricing, payments, warranty disputes or an upset customer; uncertain warranty questions are held conservatively.",
    "evidence": "Current incoming turn and exact selected service incident; source references, not unrelated older jobs.",
    "draft_step": "Hold for Gabe. Suppress customer reply and service dispatch text; remove the routine service recipients from the held draft case.",
    "owner_review": "Gabe decides personally. Never invent warranty coverage, negotiate, promise compensation or auto-handle the situation.",
    "completion": "Gabe explicitly reviews and decides. A screen hold does not mean he was texted or emailed.",
    "current_support": "Deterministic lexical holds, model-reported owner-review holds in service analysis, blank dispatch fields and visible Gabe-review status. All outputs remain drafts."
  }
].map(scenario => Object.freeze(scenario)));

export const MESSAGE_SOLUTION_GUIDANCE = `Solution maps for draft planning (version ${MESSAGE_SOLUTION_MAP_VERSION}). These are recommended reasoning steps, not available tools or authority to act. Select the relevant map or combine maps for a mixed request; never force a document, scheduling or order question into a repair case. The existing response schema, exact conversation scope, approved-fact restrictions, freshness checks, owner takeover, evidence rules and sending restrictions remain controlling. Use only supplied facts. If a required source or executor is absent, identify the missing step in the existing owner_note/summary/missing_info fields. Do not claim lookup, contact, booking, ordering, upload, delivery or closure happened. An old example or prior promise is not a new instruction or proof of completion.\n${JSON.stringify(MESSAGE_SOLUTION_MAP)}`;
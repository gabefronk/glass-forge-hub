// Pure pieces of the supplier-ETA calendar event (etaCalendar function). No I/O.
//
// Gabriel, Oct 30:
//   - Title = the job's name exactly, the same title the Jobs tab gives its visits
//     (jobCalendar: summary = Jobs.canonical_name). No "ETA - " prefix, so every
//     event for a job reads as that job.
//   - Location = the job site address, so Google shows it in the address bar.
//   - A will-call order says so in the body ("Will call: pick up at Amsco").
//   - The event goes on Israel's calendar, Milan's, or both, picked with the ETA.
import { CREW_CALENDARS, HUB_BASE_URL } from './jobCalendarCore.js';

export const ETA_CALENDAR_CHOICES = ['israel', 'milan', 'both'];
export const DEFAULT_ETA_CALENDAR = 'israel';
export const isEtaCalendarChoice = (v) => ETA_CALENDAR_CHOICES.includes(v);
// Crew calendar keys an ETA event lands on for a choice ('both' = every crew calendar).
export const etaCalendarKeys = (choice) => (choice === 'both' ? Object.keys(CREW_CALENDARS) : [isEtaCalendarChoice(choice) ? choice : DEFAULT_ETA_CALENDAR]);
export const etaCalendarId = (key) => CREW_CALENDARS[key] || null;

// VendorOrders.delivery_method. Older rows say "will-call"; new saves store will_call / delivery.
export const isWillCall = (method) => /will[\s_-]*call|pick[\s_-]*up/i.test(String(method || ''));
// '' clears it, null means the value is not one we accept.
export function normalizeDeliveryMethod(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (isWillCall(v)) return 'will_call';
  if (/^deliver(y|ed)?$/i.test(v)) return 'delivery';
  return null;
}

export const supplierName = (vendor) => {
  const v = String(vendor || '').trim();
  return /^amsco\b/i.test(v) ? 'Amsco' : v;
};

export const etaEventTitle = (job) => String(job?.canonical_name || '').trim() || 'Glass job';

const DAY_MS = 86400000;
const dayAfter = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

export function etaEventBody(job, { date, etaKey, ref = '', vendor = '', deliveryMethod = '' }) {
  const supplier = supplierName(vendor);
  const description = [
    isWillCall(deliveryMethod) ? `Will call: pick up at ${supplier || 'the supplier'}` : '',
    `Job: ${job?.canonical_name || 'Not linked'}`,
    job?.builder ? `Builder: ${job.builder}` : '',
    supplier ? `Supplier: ${supplier}` : '',
    ref ? `Reference: ${ref}` : '',
    job?.id ? `Hub job: ${HUB_BASE_URL}/jobs/${job.id}` : '',
    'Glass delivery ETA from Glass Forge Hub. This event moves with the ETA.',
  ].filter(Boolean).join('\n');
  return {
    summary: etaEventTitle(job),
    location: String(job?.address || '').trim(),
    description,
    // All-day, single day: Google's end date is exclusive.
    start: { date },
    end: { date: dayAfter(date) },
    extendedProperties: { private: { appSource: 'glassforge', hubEtaKey: etaKey, hubJobId: job?.id || '' } },
  };
}

// The event ids a link row holds, per crew calendar. Rows written before Milan's
// calendar was an option hold one google_event_id, on Israel's calendar.
export function linkEventIds(link) {
  const ids = {};
  for (const [key, id] of Object.entries(link?.google_event_ids || {})) if (CREW_CALENDARS[key] && id) ids[key] = String(id);
  if (link?.google_event_id && !Object.keys(ids).length) ids.israel = String(link.google_event_id);
  return ids;
}

// Which calendars get the event (create or move) and which lose it.
export function planEtaCalendars(choice, ids) {
  const keep = etaCalendarKeys(choice);
  return { keep, remove: Object.keys(ids || {}).filter((k) => ids[k] && !keep.includes(k)) };
}

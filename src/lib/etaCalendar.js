import { base44 } from '@/api/base44Client';

// Crew calendars an ETA event can go on (server: base44/shared/etaCalendarEvent.js).
export const ETA_CALENDAR_OPTIONS = [
  { value: 'israel', label: 'Israel' },
  { value: 'milan', label: 'Milan' },
  { value: 'both', label: 'Israel and Milan' },
];
export const DEFAULT_ETA_CALENDAR = 'israel';

// VendorOrders.delivery_method: will_call / delivery (older rows: "will-call").
export const isWillCall = (method) => /will[\s_-]*call|pick[\s_-]*up/i.test(String(method || ''));
export const deliveryChoice = (order) => (isWillCall(order?.delivery_method) ? 'will_call' : 'delivery');
export const supplierName = (vendor) => (/^amsco\b/i.test(String(vendor || '').trim()) ? 'Amsco' : String(vendor || '').trim());

export const etaKeyFor = ({ order = null, budgetId = '' }) => (order?.id ? `order:${order.id}` : budgetId ? `budget:${budgetId}` : '');

// The calendar(s) an ETA's event is on now, from its link row; Israel's when it has none.
export async function loadEtaCalendarChoice(etaKey) {
  if (!etaKey) return DEFAULT_ETA_CALENDAR;
  try {
    const rows = await base44.entities.EtaCalendarLinks.filter({ eta_key: etaKey });
    const choice = rows?.[0]?.calendar_choice;
    return ETA_CALENDAR_OPTIONS.some((o) => o.value === choice) ? choice : DEFAULT_ETA_CALENDAR;
  } catch {
    return DEFAULT_ETA_CALENDAR;
  }
}

// Keeps the ETA's Google Calendar events (on the picked crew calendars) in step
// with the ETA the Hub records. Never blocks the ETA save itself: the date is
// already saved, so a calendar failure is reported back to the caller and the
// event is fixed by saving the ETA again. No calendars = keep the ETA's current choice.
export async function syncEtaCalendar({ jobId, etaKey, date, ref = '', vendor = '', calendars = '' }) {
  try {
    const response = await base44.functions.invoke('etaCalendar', {
      job_id: jobId, eta_key: etaKey, date: date || '', ref: ref || '', vendor: vendor || '', calendars: calendars || '',
    });
    const body = response?.data ?? response;
    return body?.error ? { error: body.error } : { ...body };
  } catch (error) {
    return { error: error?.response?.data?.error || error?.message || 'calendar_sync_failed' };
  }
}

export const CALENDAR_MISSED = 'ETA saved, but its calendar event was not updated. Save the ETA again to put it on the calendar.';

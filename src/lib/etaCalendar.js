import { base44 } from '@/api/base44Client';

// Keeps the ETA's Google Calendar event (Israel's calendar) in step with the ETA
// the Hub records. Never blocks the ETA save itself: the date is already saved,
// so a calendar failure is reported back to the caller and the event is fixed by
// saving the ETA again.
export async function syncEtaCalendar({ jobId, etaKey, date, ref = '', vendor = '' }) {
  try {
    const response = await base44.functions.invoke('etaCalendar', {
      job_id: jobId, eta_key: etaKey, date: date || '', ref: ref || '', vendor: vendor || '',
    });
    const body = response?.data ?? response;
    return body?.error ? { error: body.error } : { ...body };
  } catch (error) {
    return { error: error?.response?.data?.error || error?.message || 'calendar_sync_failed' };
  }
}

export const CALENDAR_MISSED = 'ETA saved, but its calendar event was not updated. Save the ETA again to put it on the calendar.';
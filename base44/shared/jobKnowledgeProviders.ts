import { getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject } from './probuildApi.ts';
import { denverMidnight, denverDate } from './billingCore.js';

// These are reads of already-authorized providers. No calendar, fee, quote, or
// message writes occur here. The existing ProBuild auth helper may rotate its
// stored refresh token as part of normal authentication.
const GOOGLE_CALENDAR = 'iryedra@gmail.com';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const DAY = 86400000;
const defaultProbuildApi = { getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject };
const addDays = (date, count) => new Date(Date.parse(date + 'T12:00:00Z') + count * DAY).toISOString().slice(0, 10);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\s/?#]/.test(value) ? value : null;
const safeText = (value, max = 20000) => String(value ?? '').replace(/https?:\/\/[^\s<>"']+/gi, '[link omitted]').slice(0, max);
const stamp = value => { const ms = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };
const millis = value => { const text = stamp(value); return text ? Date.parse(text) : 0; };
const localDate = value => { const iso = stamp(value); return iso ? denverDate(iso) : null; };
const localTime = value => {
  const iso = stamp(value); if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && stamp(value + 'T12:00:00Z')?.slice(0, 10) === value;
const checkedClock = clock => { const value = clock(); const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) throw Error('Invalid provider clock'); return date.toISOString(); };

function budget(deadlineMs) {
  const end = Date.now() + deadlineMs;
  return async task => {
    const remaining = end - Date.now();
    if (remaining <= 0) throw Error('provider_deadline');
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('provider_deadline')), remaining); })]);
    } finally { clearTimeout(timer); }
  };
}

function bounds(options) {
  const limits = { maxCalendarPages: 100, maxCalendarItems: 20000, maxProjects: 300, maxPosts: 10000, deadlineMs: 120000, ...options };
  for (const key of ['maxCalendarPages', 'maxCalendarItems', 'maxProjects', 'maxPosts', 'deadlineMs']) {
    if (!Number.isInteger(limits[key]) || limits[key] <= 0) throw Error('Invalid provider limit');
  }
  if (limits.maxCalendarPages > 100 || limits.maxCalendarItems > 20000 || limits.maxProjects > 300 || limits.maxPosts > 10000 || limits.deadlineMs > 150000) throw Error('Provider limit exceeds bounded scope');
  return limits;
}

function resultBase(start, end, attemptedAt) {
  return { items: [], attempted_at: attemptedAt, checked_at: null, range_start: start, range_end: end, complete: false, error: null };
}

function calendarItem(event) {
  if (!event || !id(event.id)) throw Error('calendar_invalid_event_identity');
  const cancelled = event.status === 'cancelled';
  const start = event.start || {}, end = event.end || {};
  const eventDate = start.dateTime ? localDate(start.dateTime) : (validDate(start.date) ? start.date : null);
  if (!cancelled && !eventDate) throw Error('calendar_invalid_event_date');
  return {
    google_event_id: event.id, source: 'google', source_calendar: GOOGLE_CALENDAR,
    source_status: cancelled ? 'cancelled' : (event.status === 'tentative' ? 'tentative' : 'confirmed'),
    deleted: cancelled, event_date: eventDate,
    start_at: stamp(start.dateTime), end_at: stamp(end.dateTime),
    start_time: localTime(start.dateTime), end_time: localTime(end.dateTime),
    end_date: end.dateTime ? localDate(end.dateTime) : (validDate(end.date) ? end.date : null),
    all_day: Boolean(start.date && !start.dateTime),
    job_name: safeText(event.summary || (cancelled ? '' : '(untitled)'), 1000),
    scope_notes: safeText(event.description), source_location: safeText(event.location, 2000),
    created_at: stamp(event.created), source_updated_at: stamp(event.updated),
    recurring_event_id: id(event.recurringEventId),
    original_start_at: stamp(event.originalStartTime?.dateTime),
    original_start_date: validDate(event.originalStartTime?.date) ? event.originalStartTime.date : null,
    source_text_truncated: String(event.description || '').length > 20000
  };
}

async function readCalendar(base44, settings) {
  const { today, attemptedAt, clock, fetchImpl, limits, run } = settings;
  const start = addDays(today, -90), end = addDays(today, 90);
  const result = { ...resultBase(start, end, attemptedAt), calendar_name: GOOGLE_CALENDAR, pages_read: 0 };
  const byId = new Map();
  try {
    const connection = await run(() => base44.asServiceRole.connectors.getConnection('googlecalendar'));
    if (!connection?.accessToken) throw Error('calendar_not_configured');
    const headers = { Authorization: `Bearer ${connection.accessToken}` };
    const query = new URLSearchParams({ maxResults: '250', singleEvents: 'true', showDeleted: 'true', orderBy: 'startTime', timeMin: denverMidnight(start), timeMax: denverMidnight(addDays(end, 1)) });
    const baseUrl = `${GOOGLE_API}/calendars/${encodeURIComponent(GOOGLE_CALENDAR)}/events?${query}`;
    let token = null;
    const tokens = new Set();
    for (let page = 0; page < limits.maxCalendarPages; page++) {
      const response = await run(() => fetchImpl(baseUrl + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { headers, signal: AbortSignal.timeout(Math.min(30000, limits.deadlineMs)) }));
      if (!response.ok) throw Error('calendar_http_' + response.status);
      const data = await run(() => response.json());
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.error || (data.items !== undefined && !Array.isArray(data.items))) throw Error('calendar_invalid_page');
      result.pages_read++;
      for (const event of data.items || []) {
        const item = calendarItem(event);
        // Overlap queries can legitimately include an event starting before the
        // requested day window; preserve its original date rather than relabel it.
        if (byId.has(item.google_event_id) && JSON.stringify(byId.get(item.google_event_id)) !== JSON.stringify(item)) throw Error('calendar_conflicting_identity');
        if (!byId.has(item.google_event_id) && byId.size >= limits.maxCalendarItems) throw Error('calendar_item_limit');
        byId.set(item.google_event_id, item);
      }
      if (data.nextPageToken == null || data.nextPageToken === '') {
        result.complete = true; result.checked_at = checkedClock(clock); break;
      }
      if (typeof data.nextPageToken !== 'string' || tokens.has(data.nextPageToken)) throw Error('calendar_repeated_page_token');
      tokens.add(data.nextPageToken); token = data.nextPageToken;
    }
    if (!result.complete) throw Error('calendar_page_limit');
  } catch (error) {
    const code = String(error?.message || '');
    result.error = /^(calendar_[a-z_]+(?:\d+)?|provider_deadline)$/.test(code) ? code : 'calendar_read_failed';
    result.complete = false; result.checked_at = null;
  }
  result.items = [...byId.values()];
  return result;
}

function attachmentCount(value) {
  if (Array.isArray(value)) return value.filter(Boolean).length;
  return value && typeof value === 'object' ? Object.values(value).filter(Boolean).length : 0;
}

async function readProbuild(base44, settings) {
  const { today, attemptedAt, clock, probuildApi, limits, run } = settings;
  const start = addDays(today, -30), end = today;
  const result = { ...resultBase(start, end, attemptedAt), scope: '31_day_incremental_project_activity', project_selection: 'recently_modified_or_unknown', history_complete: false,
    project_activity_basis: 'latest_valid_lastModifiedAt_updatedAt_createdAt', known_unchanged_excluded_count: 0, unknown_project_date_count: 0,
    active_project_count: 0, project_count: 0, projects_read: 0, failed_project_ids: [], deleted_projects: [], undated_post_count: 0, source_posts_read: 0,
    selection_uncertainties: ['Project activity metadata is the selection boundary; older project histories are not revalidated.'] };
  const items = new Map();
  const reasons = new Set();
  try {
    const token = await run(() => probuildApi.getProbuildIdToken(base44));
    if (typeof token !== 'string' || !token) throw Error('probuild_auth_failed');
    const projects = await run(() => probuildApi.fetchProbuildProjects(token));
    if (!Array.isArray(projects)) throw Error('probuild_invalid_projects');
    const unique = new Map();
    for (const project of projects) {
      if (!project || !id(String(project.id || ''))) throw Error('probuild_invalid_project_identity');
      if (unique.has(String(project.id))) throw Error('probuild_duplicate_project_identity');
      unique.set(String(project.id), project);
    }
    const active = [...unique.values()].filter(project => !project.deletedAt);
    result.active_project_count = active.length;
    const cutoff = Date.parse(denverMidnight(start));
    const observationMs = Date.parse(attemptedAt);
    const projectActivity = project => {
      // Include unknown dates conservatively. Future/invalid timestamps cannot
      // establish that a project is unchanged, and never freshen its history.
      const values = [project.lastModifiedAt, project.updatedAt, project.createdAt].map(millis).filter(value => value > 0 && value <= observationMs);
      return values.length ? Math.max(...values) : null;
    };
    const qualifying = active.map(project => ({ project, activity: projectActivity(project) })).filter(({ activity }) => {
      if (activity === null) { result.unknown_project_date_count++; return true; }
      if (activity >= cutoff) return true;
      result.known_unchanged_excluded_count++; return false;
    }).sort((a, b) => (b.activity || 0) - (a.activity || 0) || String(a.project.id).localeCompare(String(b.project.id))).map(({ project }) => project);
    result.project_count = qualifying.length;
    if (result.unknown_project_date_count) result.selection_uncertainties.push('Projects without a reliable activity timestamp were included; their activity range is unknown.');
    result.deleted_projects = [...unique.values()].filter(project => project.deletedAt).map(project => ({ project_id: String(project.id), job_name: safeText(project.name || project.title, 1000), deleted: true, deleted_at: stamp(project.deletedAt) }));
    if (qualifying.length > limits.maxProjects) reasons.add('probuild_project_limit');
    const selected = qualifying.slice(0, limits.maxProjects);
    let cursor = 0;
    const worker = async () => {
      while (cursor < selected.length && !reasons.has('provider_deadline') && !reasons.has('probuild_post_limit')) {
        const project = selected[cursor++];
        try {
          const rows = await run(() => probuildApi.fetchProbuildPostsForProject(token, String(project.id)));
          if (!Array.isArray(rows)) throw Error('probuild_invalid_posts');
          result.projects_read++; result.source_posts_read += rows.length;
          // Read newest first, but preserve edits/deletions to older posts whose
          // activity falls in this 31-day window. Unknown dates are incomplete.
          rows.sort((a, b) => Math.max(millis(b.post?.createdAt), millis(b.post?.lastModifiedAt), millis(b.post?.deletedAt)) - Math.max(millis(a.post?.createdAt), millis(a.post?.lastModifiedAt), millis(a.post?.deletedAt)));
          for (const row of rows) {
            if (!row || String(row.projectId) !== String(project.id) || !id(String(row.postId || '')) || !row.post || typeof row.post !== 'object') throw Error('probuild_invalid_post_identity');
            const post = row.post;
            const created = stamp(post.createdAt), modified = stamp(post.lastModifiedAt || post.updatedAt), deleted = stamp(post.deletedAt);
            const dates = [created, modified, deleted].filter(Boolean).map(localDate);
            if (!dates.length) { result.undated_post_count++; reasons.add('probuild_undated_posts'); continue; }
            if (!dates.some(date => date >= start && date <= end)) continue;
            if (items.size >= limits.maxPosts) { reasons.add('probuild_post_limit'); break; }
            const item = { project_id: String(project.id), post_id: String(row.postId), source: 'probuild', job_name: safeText(project.name || project.title, 1000),
              job_date: created ? localDate(created) : null, message: safeText(post.message), created_at: created, source_updated_at: modified,
              deleted: Boolean(post.deletedAt), deleted_at: deleted, attachment_count: attachmentCount(post.attachments), source_text_truncated: String(post.message || '').length > 20000 };
            const key = item.project_id + ':' + item.post_id;
            if (items.has(key)) throw Error('probuild_duplicate_post_identity');
            items.set(key, item);
          }
        } catch (error) {
          result.failed_project_ids.push(String(project.id));
          reasons.add(error?.message === 'provider_deadline' ? 'provider_deadline' : 'probuild_project_read_failed');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, selected.length) }, () => worker()));
    if (result.projects_read !== selected.length) reasons.add('probuild_projects_incomplete');
    result.complete = reasons.size === 0;
    if (result.complete) result.checked_at = checkedClock(clock);
  } catch (error) {
    const code = String(error?.message || '');
    reasons.add(/^(probuild_[a-z_]+|provider_deadline)$/.test(code) ? code : 'probuild_read_failed');
  }
  result.items = [...items.values()].sort((a, b) => millis(b.source_updated_at || b.created_at) - millis(a.source_updated_at || a.created_at));
  result.error = reasons.size ? [...reasons].join(',') : null;
  if (result.error) { result.complete = false; result.checked_at = null; }
  return result;
}

export async function readJobKnowledgeProviders(base44, options = {}) {
  const clock = options.clock || (() => new Date());
  const attemptedAt = options.now ? stamp(options.now) : checkedClock(clock);
  if (!attemptedAt) throw Error('Invalid provider time');
  const limits = bounds(options);
  const shared = { today: denverDate(attemptedAt), attemptedAt, clock, limits, fetchImpl: options.fetchImpl || fetch, probuildApi: options.probuildApi || defaultProbuildApi };
  // Separate budgets prevent one failing provider from cancelling the other.
  const [calendar, probuild] = await Promise.all([
    readCalendar(base44, { ...shared, run: budget(limits.deadlineMs) }),
    readProbuild(base44, { ...shared, run: budget(limits.deadlineMs) })
  ]);
  return { calendar, probuild };
}

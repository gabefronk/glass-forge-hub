// Personal task views share one set of records. A focus date is not a deadline.
export const PERSONAL_VIEWS = ['today', 'inbox', 'upcoming', 'waiting', 'all'];
export function initialPersonalView(search = '') {
  const view = new URLSearchParams(search).get('view');
  return PERSONAL_VIEWS.includes(view) ? view : 'today';
}
export const isWaiting = task => Boolean(String(task.waiting_on || '').trim());
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
export function isForToday(task, today) {
  const due = date(task.due_date), focus = date(task.focus_date), followUp = date(task.follow_up_date);
  if (isWaiting(task)) return Boolean((due && due <= today) || (followUp && followUp <= today));
  return Boolean((due && due <= today) || (focus && focus <= today) || task.status === 'in_progress');
}
export function personalTaskViews(tasks, today) {
  const active = (tasks || []).filter(t => t && t.status !== 'done' && !t.archived_at);
  const ordered = [...active].sort((a, b) => {
    const overdue = t => Boolean(date(t.due_date) && t.due_date < today);
    const next = t => [date(t.due_date), date(t.focus_date), isWaiting(t) && date(t.follow_up_date)].filter(Boolean).sort()[0] || '9999';
    return Number(overdue(b)) - Number(overdue(a)) || next(a).localeCompare(next(b)) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
  return {
    today: ordered.filter(t => isForToday(t, today)),
    inbox: ordered.filter(t => !isWaiting(t) && !date(t.due_date) && !date(t.focus_date) && t.status !== 'in_progress'),
    upcoming: ordered.filter(t => !isForToday(t, today) && [date(t.due_date), isWaiting(t) ? date(t.follow_up_date) : date(t.focus_date)].some(d => d && d > today)),
    waiting: ordered.filter(isWaiting),
    all: ordered,
  };
}
export function filterPersonalTasks(tasks, query, category = '') {
  const needle = String(query || '').trim().toLowerCase();
  return tasks.filter(t => (!category || t.category === category) && (!needle || [t.title, t.details, t.progress_note, t.waiting_on].some(v => String(v || '').toLowerCase().includes(needle))));
}

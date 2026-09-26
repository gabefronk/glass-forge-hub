// Job history: one dated log of everything that happened on a job.
// Pure helpers so the timeline can be tested without React or the API.

export const INTERACTION_TYPES = [
  { value: "note", label: "Note" },
  { value: "site_visit", label: "Site visit" },
  { value: "call", label: "Phone call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "delivery", label: "Delivery" },
  { value: "issue", label: "Issue" },
];

export function interactionLabel(value) {
  return (INTERACTION_TYPES.find((t) => t.value === value) || INTERACTION_TYPES[0]).label;
}

export const HISTORY_FILTERS = [
  { key: "all", label: "All" },
  { key: "visits", label: "Visits" },
  { key: "reports", label: "Field reports" },
  { key: "notes", label: "Notes & calls" },
  { key: "files", label: "Files" },
];

// Reports are normalized by source record id (probuild_post_id) so each post
// renders exactly once, whether it came from FieldReports or a fee line.
export function buildReports(rows, fieldReports) {
  const byPost = new Map();
  for (const fr of fieldReports || []) {
    if (!fr.post_id) continue;
    byPost.set(fr.post_id, {
      post_id: fr.post_id,
      date: fr.job_date,
      message: fr.message || "",
      photos: fr.photo_urls || [],
      created_at: fr.created_at || "",
      author: "",
    });
  }
  for (const r of rows || []) {
    if ((r.source === "probuild" || r.source === "both") && r.probuild_post_id && !byPost.has(r.probuild_post_id)) {
      byPost.set(r.probuild_post_id, {
        post_id: r.probuild_post_id,
        date: r.job_date,
        message: mergeNoteTexts(r.note_text, r.probuild_note_text),
        photos: r.photo_urls || [],
        created_at: r.probuild_job_date || r.job_date || "",
        author: r.calendar_creator || "",
      });
    }
  }
  return [...byPost.values()];
}

// The same report text is often stored twice (note_text and probuild_note_text).
// Show it once; keep both only when they genuinely differ.
export function mergeNoteTexts(...texts) {
  const out = [];
  for (const raw of texts) {
    const t = String(raw || "").trim();
    if (!t) continue;
    const norm = (v) => v.replace(/\s+/g, " ").toLowerCase();
    const i = out.findIndex((o) => norm(o).includes(norm(t)) || norm(t).includes(norm(o)));
    if (i === -1) out.push(t);
    else if (t.length > out[i].length) out[i] = t;
  }
  return out.join("\n\n");
}

export function isFieldReportNote(note) {
  return (note?.attachments?.length > 0) || !!note?.completion;
}

const dayOf = (value) => (value ? String(value).slice(0, 10) : "");

// Which filter chips an entry belongs to (it always belongs to "all").
export function entryGroups(entry) {
  if (entry.kind === "visit") return entry.reports?.length ? ["visits", "reports"] : ["visits"];
  if (entry.kind === "change") return ["visits"];
  if (entry.kind === "report") return ["reports"];
  if (entry.kind === "file") return ["files"];
  if (entry.kind === "note") return isFieldReportNote(entry.note) ? ["reports"] : ["notes"];
  return [];
}

export function buildJobHistory({ events, rows, notes, fieldReports, files } = {}) {
  const reports = buildReports(rows, fieldReports);
  const reportsByDate = new Map();
  for (const r of reports) {
    const list = reportsByDate.get(r.date) || [];
    list.push(r);
    reportsByDate.set(r.date, list);
  }

  const items = [];
  const attached = new Set();
  for (const ev of events || []) {
    if (!ev.event_date) continue;
    const dayReports = (reportsByDate.get(ev.event_date) || []).filter((r) => !attached.has(r.post_id));
    dayReports.forEach((r) => attached.add(r.post_id));
    items.push({ kind: "visit", date: ev.event_date, when: `${ev.event_date}T${ev.start_time || "00:00"}`, ev, reports: dayReports });
    if (ev.reschedule_count > 0 && ev.original_scheduled_date && ev.original_scheduled_date !== ev.event_date) {
      items.push({ kind: "change", date: ev.event_date, when: `${ev.event_date}T23:59`, ev });
    }
  }
  for (const r of reports) {
    if (!attached.has(r.post_id)) items.push({ kind: "report", date: r.date, when: r.created_at || `${r.date}T12:00`, report: r });
  }
  for (const n of notes || []) {
    // Order same-day entries by when the note was saved, when we know it.
    const saved = n.created_date && dayOf(n.created_date) === n.note_date ? String(n.created_date) : `${n.note_date}T23:58`;
    items.push({ kind: "note", date: n.note_date, when: saved, note: n });
  }
  for (const f of files || []) {
    const date = dayOf(f.modified_at);
    if (!date) continue;
    items.push({ kind: "file", date, when: String(f.modified_at), file: f });
  }

  const valid = items.filter((it) => /^\d{4}-\d{2}-\d{2}$/.test(it.date || ""));
  for (const it of valid) it.groups = entryGroups(it);
  return valid;
}

export function historyCounts(entries) {
  const counts = { all: entries.length, visits: 0, reports: 0, notes: 0, files: 0 };
  for (const e of entries) for (const g of e.groups || []) counts[g] += 1;
  return counts;
}

// Newest day first; inside a day, oldest first so the day reads in order.
export function groupHistoryByDay(entries, filter = "all") {
  const shown = filter === "all" ? entries : entries.filter((e) => (e.groups || []).includes(filter));
  const byDate = new Map();
  for (const it of shown) {
    const list = byDate.get(it.date) || [];
    list.push(it);
    byDate.set(it.date, list);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, items: list.sort((a, b) => a.when.localeCompare(b.when)) }));
}

// Split a Drive job folder listing into plan documents and site photos.
export function splitFolderFiles(files) {
  const plans = [], photos = [], other = [];
  for (const f of files || []) {
    const mime = String(f.mime_type || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    if (mime.startsWith("image/") || /\.(jpe?g|png|heic|webp|gif)$/.test(name)) photos.push(f);
    else if (mime === "application/pdf" || /\.pdf$/.test(name) || mime.startsWith("application/vnd.google-apps")) plans.push(f);
    else other.push(f);
  }
  const newest = (a, b) => String(b.modified_at || "").localeCompare(String(a.modified_at || ""));
  return { plans: plans.sort(newest), photos: photos.sort(newest), other: other.sort(newest) };
}

// Latest site photos from reports and notes, newest first, deduped by URL.
export function recentSitePhotos(entries, limit = 9) {
  const seen = new Set(), out = [];
  const sorted = [...entries].sort((a, b) => b.when.localeCompare(a.when));
  for (const e of sorted) {
    const urls = e.kind === "report" ? e.report.photos
      : e.kind === "visit" ? e.reports.flatMap((r) => r.photos || [])
      : e.kind === "note" ? e.note.attachments || []
      : [];
    for (const url of urls || []) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, date: e.date });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Realtime events cover the whole entity; only reload when one touches this
// job. A delete may carry no job_id, so also match records already on screen.
export function touchesJob(event, memberIds, shownIds = []) {
  const ids = new Set(memberIds || []);
  const rec = event?.data || {};
  if (rec.job_id && ids.has(rec.job_id)) return true;
  const id = event?.id || rec.id;
  return !!id && new Set(shownIds).has(id);
}

// Small type badge for a file, by extension first, then MIME type.
export function fileBadge(name, mime) {
  const n = String(name || "").toLowerCase(), m = String(mime || "").toLowerCase();
  if (/\.pdf$/.test(n) || m === "application/pdf") return { label: "PDF", bg: "#FCEDEC", ink: "#A43432" };
  if (/\.(csv|xlsx?|numbers)$/.test(n) || /spreadsheet|excel|csv/.test(m)) return { label: n.endsWith(".csv") ? "CSV" : "XLS", bg: "#E2EEEB", ink: "#0B3F3B" };
  if (/\.(docx?|txt|rtf)$/.test(n) || /document|msword|text\//.test(m)) return { label: "DOC", bg: "#E7EDF2", ink: "#34506A" };
  if (/\.(jpe?g|png|heic|webp|gif)$/.test(n) || m.startsWith("image/")) return { label: "IMG", bg: "#FAF0DA", ink: "#8A5A12" };
  if (/\.(dwg|dxf)$/.test(n)) return { label: "CAD", bg: "#EEF1F3", ink: "#34403F" };
  return { label: "FILE", bg: "#EEF1F3", ink: "#566063" };
}

// A file name to show, never blank (a name can be emptied by the price filter).
export function fileLabel(clean, name) {
  const shown = String(clean || "").trim();
  if (shown) return shown;
  const ext = String(name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1];
  return ext ? `Untitled ${ext.toUpperCase()} file` : "Untitled file";
}

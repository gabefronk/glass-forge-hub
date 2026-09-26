const img = (c) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30' fill='%23${c}'/%3E%3C/svg%3E`;
const jobs = [{ id: "fs", canonical_name: "Fieldstone 215 The Crossings", builder: "", address: "2846 E Hayloft Lane Heber", created_date: "2026-09-20T10:00:00Z", po_numbers: ["6851328"], oe_numbers: ["79693933-00"] }];
const events = [{ id: "e1", job_id: "fs", event_date: "2026-09-22", job_name: "YA - #1 Fieldstone 215 The Crossings", scope_notes: "Amsco Investigation *Closing 9/24*<br>Take shoes off, carpets are being cleaned.<br>SPR: Mike Shaw", created_by: "iryedra@gmail.com", source: "google", report_status: "ok", report_required: true }];
const fieldReports = [{ id: "r1", post_id: "p1", job_id: "fs", job_date: "2026-09-22", message: "Changed out the balance springs that was getting stuck and put the new one in, checked ops in all the windows. 1 vinyl man hour", photo_urls: Array.from({length: 11}, (_, i) => img(['a9b3a8','8f9a97','c9c2b4','7d8a86'][i%4])) }];
const notes = [{ id: "n1", job_id: "fs", note_date: "2026-09-23", body: "Mike confirmed all windows work. Closing still on for 9/24.", author: "gabefronk@gmail.com", interaction_type: "call" }];
const byName = { Jobs: jobs, CalendarEvents: events, JobNotes: notes, FieldReports: fieldReports, FeeLines: [], PlanIntake: [] };
const entity = (name) => ({ list: async (s, l = 1000, k = 0) => (byName[name] || []).slice(k, k + l), filter: async (q) => (byName[name] || []).filter((r) => Object.entries(q).every(([a, b]) => r[a] === b)), get: async (id) => (byName[name] || []).find((r) => r.id === id) || null, subscribe: () => () => {} });
export const base44 = { entities: new Proxy({}, { get: (_, n) => entity(n) }), auth: { me: async () => ({ email: "gabefronk@gmail.com", role: "admin" }) },
  functions: { invoke: async (fn, body) => {
    if (fn === "job-documents") return { data: { folder: null, files: [], status: "unlinked" } };
    if (fn === "contacts-directory") return { data: { job: { id: body.job_id }, linked: [], suggestions: [], status: { missing_superintendent: true, missing_contact: true, suggestions: 0 } } };
    return { data: {} }; } }, integrations: { Core: {} }, agents: {} };

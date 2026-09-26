const img = (c) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30' fill='%23${c}'/%3E%3C/svg%3E`;
const jobs = [{ id: "av24", canonical_name: "AV24 - Aria-Belle - 1212 North Luna Circle - RETRO", builder: "Aria-Belle", address: "1212 North Luna Circle, Elk Ridge, UT", created_date: "2026-09-20T10:00:00Z", po_numbers: ["7330440"], oe_numbers: [], drive_job_folder_id: "F1", customer_name: "Justin Hutchins" }];
const events = [{ id: "e1", job_id: "av24", event_date: "2026-09-29", job_name: "AV24 retro install", scope_notes: "Remove 6 existing windows<br>Install AMSCO retro units<br>Foam and seal exterior", created_by: "iryedra@gmail.com", source: "google", report_status: "pending", report_required: true }];
const fieldReports = [
  { id: "r1", post_id: "p1", job_id: "av24", job_date: "2026-09-18", message: "Measured all openings. Two bedroom windows have rot on the sill.", photo_urls: [img("a9b3a8"), img("8f9a97"), img("c9c2b4")] },
  { id: "r2", post_id: "p2", job_id: "av24", job_date: "2026-09-22", message: "Dropped samples with homeowner.", photo_urls: [img("7d8a86")] } ];
const notes = [{ id: "n1", job_id: "av24", note_date: "2026-09-24", body: "Justin wants install before Oct 1.", author: "gabefronk@gmail.com", interaction_type: "call" }];
const byName = { Jobs: jobs, CalendarEvents: events, JobNotes: notes, FieldReports: fieldReports, FeeLines: [], PlanIntake: [] };
const entity = (name) => ({ list: async (s, l = 1000, k = 0) => (byName[name] || []).slice(k, k + l), filter: async (q) => (byName[name] || []).filter((r) => Object.entries(q).every(([a, b]) => r[a] === b)), get: async (id) => (byName[name] || []).find((r) => r.id === id) || null, subscribe: () => () => {} });
export const base44 = { entities: new Proxy({}, { get: (_, n) => entity(n) }), auth: { me: async () => ({ email: "gabefronk@gmail.com", role: "admin" }) },
  functions: { invoke: async (fn, body) => {
    if (fn === "job-documents") return { data: { folder: { id: "F1", url: "#" }, complete: true, files: [
      { id: "d1", name: "AV24 - Aria-Belle - submittal plan set.pdf", mime_type: "application/pdf", url: "#", modified_at: "2026-09-25T10:00:00Z" },
      { id: "d2", name: "Price sheet.pdf", mime_type: "application/pdf", url: "#", modified_at: "2026-09-25T10:00:00Z" },
      { id: "d3", name: "AV24 - Aria-Belle - RETRO - takeoff.csv", mime_type: "text/csv", url: "#", modified_at: "2026-09-25T09:00:00Z" } ] } };
    if (fn === "contacts-directory") return { data: { job: { id: body.job_id }, linked: [{ key: "c1", name: "Justin Hutchins", role: "customer", phone: "801-555-0142", email: "justin@example.com" }, { key: "c2", name: "Cort Jensen", role: "superintendent", phone: "801-529-7512" }], suggestions: [], status: { missing_superintendent: false, missing_contact: false, suggestions: 0 } } };
    return { data: {} }; } }, integrations: { Core: {} }, agents: {} };

const jobs = [{ id: "ph", canonical_name: "patterson homes - 10 beck hillside estates", builder: "Patterson Homes", address: "771 N 150 E American Fork, UT 84003", created_date: "2026-09-20T10:00:00Z", po_numbers: ["7250080"], oe_numbers: ["79332999-02"] }];
const events = [{ id: "e1", job_id: "ph", event_date: "2026-09-23", job_name: "Patterson install", scope_notes: "Amsco direct – 9/14<br>QTY.29<br>08-923<br>Windor del to BFS – 8/26<br>QTY.2 | Here: 8/25/2026", created_by: "iryedra@gmail.com", source: "google", report_status: "ok", report_required: true }];
const byName = { Jobs: jobs, CalendarEvents: events, JobNotes: [], FieldReports: [], FeeLines: [], PlanIntake: [] };
const entity = (name) => ({ list: async (s, l = 1000, k = 0) => (byName[name] || []).slice(k, k + l), filter: async (q) => (byName[name] || []).filter((r) => Object.entries(q).every(([a, b]) => r[a] === b)), get: async (id) => (byName[name] || []).find((r) => r.id === id) || null, subscribe: () => () => {} });
export const base44 = { entities: new Proxy({}, { get: (_, n) => entity(n) }), auth: { me: async () => ({ email: "gabefronk@gmail.com", role: "admin" }) },
  functions: { invoke: async (fn, body) => {
    if (fn === "job-documents") return { data: { folder: null, files: [], status: "unlinked" } };
    if (fn === "contacts-directory") return { data: { job: { id: body.job_id }, linked: [{ key: "c2", name: "Cort Jensen", role: "superintendent", phone: "801-529-7512" }, { key: "c1", name: "Justin Hutchins", role: "customer", phone: "801-555-0142" }], suggestions: [], status: { missing_superintendent: false, missing_contact: false, suggestions: 0 } } };
    return { data: {} }; } }, integrations: { Core: {} }, agents: {} };

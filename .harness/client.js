const today = "2026-09-25";
const J = (id, canonical_name, builder, address, extra = {}) => ({ id, canonical_name, builder, address, created_date: "2026-09-0" + (id.length % 9) + "T10:00:00Z", po_numbers: [], oe_numbers: [], ...extra });
const jobs = [
  J("rainey", "Rainey 9-138 Daybreak", "Rainey", "6741 W Splash Way, South Jordan", { po_numbers: ["7249419"], oe_numbers: ["79567505-00"], drive_job_folder_id: "F1" }),
  J("barker", "Barker — AMSCO will-call pickup", "Barker", "2141 W Aspen Wood Loop N, Lehi"),
  J("brewer", "Home Sweet Home — Brewer", "Home Sweet Home", "1149 N Titan Dr, Lehi"),
  J("ejv", "EJV Construction — Hoytsville", "EJV Construction", "Hoytsville"),
  J("holmes", "Holmes Homes — 203 Lakeview", "Holmes Homes", "203 Lakeview"),
  J("durkin", "Durkin 62 Wildwood", "Durkin", "62 Wildwood"),
];
const ev = (id, job_id, event_date, job_name, scope_notes, extra = {}) => ({ id, job_id, event_date, job_name, scope_notes, created_by: "iryedra@gmail.com", source: "google", report_required: true, report_status: "pending", ...extra });
const events = [
  ev("e1", "rainey", today, "Rainey 9-138 Daybreak Andersen warranty", "Replace 1626 FX glass, primary bath<br>Replace 2 x 1626 accents<br>Replace 2646 SH pantry deadlight (broken on arrival)<br>Labor $450", { po_number: "7302254", event_attachments: [{ title: "Andersen order 26444628.pdf", file_url: "https://mail.google.com/?view=att&th=1&attid=0.1" }] }),
  ev("e0", "rainey", "2026-09-21", "Rainey glass received", "Replacement glass received at BFS", { report_status: "ok" }),
  ev("e2", "barker", today, "Barker AMSCO pickup", "Grab the patio door at AMSCO, drop at Todd's 9-11"),
  ev("e3", "brewer", today, "Brewer service", "Dining 5050 XO: re-secure the separating sash"),
  ev("e4", "ejv", "2026-09-26", "EJV warranty", "Replace 1660 FX glass in the nook"),
  ev("e5", "holmes", "2026-09-22", "Holmes service", "Install Bonelli handle", { days_late: 3 }),
  ev("e6", "durkin", "2026-09-23", "Durkin warranty", "Water test the door"),
];
const notes = [{ id: "n1", job_id: "rainey", note_date: "2026-09-24", body: "Talked to Cort, gate code 4411. Dog in backyard.", author: "gabefronk@gmail.com", interaction_type: "call" }];
const fieldReports = [{ id: "fr1", post_id: "p1", job_id: "rainey", job_date: "2026-09-21", message: "Glass checked in, crate 2 of 2", photo_urls: ["data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30' fill='%23a9b3a8'/%3E%3C/svg%3E"] }];
const byName = { Jobs: jobs, CalendarEvents: events, JobNotes: notes, FieldReports: fieldReports, FeeLines: [], PlanIntake: [] };
const entity = (name) => ({
  list: async (sort, limit = 1000, skip = 0) => (byName[name] || []).slice(skip, skip + limit),
  filter: async (q) => (byName[name] || []).filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)),
  get: async (id) => (byName[name] || []).find((r) => r.id === id) || null,
  subscribe: () => () => {},
});
export const base44 = {
  entities: new Proxy({}, { get: (_, name) => entity(name) }),
  auth: { me: async () => ({ email: "gabefronk@gmail.com", role: "admin", full_name: "Gabe" }) },
  functions: { invoke: async (fn, body) => {
    if (fn === "job-documents") return { data: body.job_id === "rainey" ? { folder: { id: "F1", url: "#" }, complete: true, files: [
      { id: "d1", name: "Andersen replacement order 26512506.pdf", mime_type: "application/pdf", url: "#", modified_at: "2026-09-22T10:00:00Z" },
      { id: "d2", name: "IMG_9734.jpg", mime_type: "image/jpeg", url: "#", modified_at: "2026-09-24T10:00:00Z" } ] } : { folder: null, files: [], status: "unlinked" } };
    if (fn === "contacts-directory") return { data: { job: { id: body.job_id }, linked: body.job_id === "rainey" ? [{ key: "c1", name: "Cort Jensen", role: "superintendent", phone: "801-529-7512" }] : [], suggestions: [], status: { missing_superintendent: body.job_id !== "rainey", missing_contact: body.job_id !== "rainey", suggestions: 0 } } };
    return { data: {} };
  } },
  integrations: { Core: {} }, agents: {},
};

const SCOPE = 'Please install window as well.<br>ANDERSEN WARRANTY<br>*WARANTY* - Per Report: 1 – 1626 fx primary bath | 2 - 1626 accents (LINE: 27) | 1 – 2646 sh pantry deadlight - (Line#: 11) *Orig. PO#: 7249419* AW# 26316092<br>Product ETA – Wk of: 9/23 | | Vendor Order #: Confirmation Number: 2386318<br>Received: 9/21';
const JOB = { id: 'j1', canonical_name: 'rainey - warranty glass', builder: 'Holmes Homes', address: '6847 W Ripple Rd, South Jordan', po_numbers: ['7302254'], oe_numbers: ['79567505-00'] };
const EVENTS = [{ id: 'e1', job_id: 'j1', event_date: '2026-09-25', job_name: '#1 Rainey warranty', created_by: 'ragen@x.com', scope_notes: SCOPE, report_required: true, report_status: 'due', event_attachments: [{ title: 'Report.pdf', file_url: 'https://mail.google.com/mail/?view=att&x=1' }, { title: 'order.pdf', file_url: 'https://drive.google.com/file/d/abc', drive_url: 'https://drive.google.com/file/d/abc' }] }];
const PH = (c) => `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='${c}'/><rect x='120' y='80' width='160' height='140' fill='%23222'/></svg>`;
const REPORTS = [{ id: 'fr1', job_id: 'j1', job_name: 'Rainey warranty', job_date: '2026-09-25', author: 'ragen@x.com', photos: [PH('%23c9b58a'), PH('%23b9a17a'), PH('%23d6c39a'), PH('%23a8946c'), PH('%23c2ad84')], note_text: 'Changed the balance springs, checked ops on all windows. 1 man hour' }];
const rows = { Jobs: [JOB], CalendarEvents: EVENTS, FieldReports: REPORTS };
const entity = (name) => ({
  get: async () => JOB,
  list: async (_s, _l, skip) => (skip ? [] : rows[name] || []),
  filter: async () => rows[name] || [],
  subscribe: () => () => {},
});
const saved = { super: window.__SUPER__ || null };
export const base44 = {
  auth: { me: async () => ({ email: 'gabefronk@gmail.com', role: 'admin' }) },
  entities: new Proxy({}, { get: (_t, k) => entity(k) }),
  functions: {
    invoke: async (name, body) => {
      if (name === 'job-documents') return { data: { folder: null, files: [], complete: true } };
      if (name === 'contacts-directory' && body.action === 'job_super') return { data: saved };
      if (name === 'contacts-directory' && body.action === 'set_job_super') { saved.super = { key: 'k', ...body.contact }; return { data: saved }; }
      if (name === 'contacts-directory') return { data: { job: { id: 'j1' }, linked: [], suggestions: [], status: {} } };
      return { data: {} };
    },
  },
};

// Framework-free core of the job-super load/save flow, so the ordering rules are
// testable without React. `call` posts to the contacts-directory function.
// One super per job: saving reuses a directory contact with the same phone or
// email and links it to the job as superintendent.
export function createJobSuperSession(jobId, call) {
  let version = 0;
  let state = { loading: true, saved: null, error: "" };
  const listeners = new Set();
  const set = (next) => { state = next; listeners.forEach((fn) => fn(state)); };
  const load = async () => {
    const n = ++version;
    if (!jobId) { set({ loading: false, saved: null, error: "" }); return; }
    set({ ...state, loading: true });
    try {
      const data = await call({ action: "job_super", job_id: jobId });
      if (n === version) set({ loading: false, saved: data?.super || null, error: "" });
    } catch (e) {
      if (n === version) set({ loading: false, saved: null, error: e.message });
    }
  };
  const save = async ({ name, phone, email }) => {
    // A save wins over any load already in flight: bumping the version makes a
    // stale read resolving after the write a no-op, so it cannot blank the super.
    version++;
    const data = await call({ action: "set_job_super", job_id: jobId, contact: { name, phone, email } });
    set({ loading: false, saved: data?.super || null, error: "" });
    return data?.super;
  };
  const invalidate = () => { version++; };
  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    load, save, invalidate,
  };
}

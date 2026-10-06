// One-shot Jobs.create for a New Job wizard session. After a success or an
// unknown outcome (no verified pre-write rejection) the session is locked:
// later calls never create again. On an unknown outcome it does a read-only
// search for jobs with the same name so the user can find a job that may have
// been written; an empty search does NOT unlock creating (reads can lag).
import { isVerifiedRejection, createErrorMessage } from "@/lib/createOutcome";

export function createJobGuard({ api }) {
  let busy = false;
  let locked = null; // "created" | "uncertain"
  return async function createJob(payload) {
    if (locked) return { state: "locked", reason: locked };
    if (busy) return { state: "busy" };
    busy = true;
    try {
      const job = await api.create(payload);
      locked = "created";
      return { state: "created", job };
    } catch (e) {
      if (isVerifiedRejection(e)) return { state: "rejected", error: createErrorMessage(e, "The job was rejected.") };
      locked = "uncertain";
      let matches = [];
      try {
        const page = await api.filter({ canonical_name: payload.canonical_name }, { sort: "-created_date", limit: 10, fields: ["id", "canonical_name", "address", "created_date"] });
        matches = Array.isArray(page) ? page : page?.items || [];
      } catch { /* read-only lookup; stay uncertain */ }
      return { state: "uncertain", error: createErrorMessage(e, "No response from the server."), matches };
    } finally {
      busy = false;
    }
  };
}
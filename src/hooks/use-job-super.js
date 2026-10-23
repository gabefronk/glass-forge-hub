import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeErrorOf } from "@/lib/jobContacts";
import { createJobSuperSession } from "@/lib/jobSuperSession";

const call = async (body) => {
  try {
    const r = await base44.functions.invoke("contacts-directory", body);
    if (r?.data?.error) throw new Error(r.data.error);
    return r.data;
  } catch (error) {
    throw new Error(invokeErrorOf(error).message || error.message || "Contacts are unavailable.");
  }
};

// The job's saved super, readable and editable by anyone signed in. The load/save
// ordering rules live in createJobSuperSession (a save wins over a load already
// in flight); this hook only binds the session to React.
export function useJobSuper(jobId) {
  const ref = useRef(null);
  if (!ref.current || ref.current.jobId !== jobId) ref.current = { jobId, session: createJobSuperSession(jobId, call) };
  const session = ref.current.session;
  const [state, setState] = useState(session.getState);
  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    session.load();
    return () => { unsubscribe(); session.invalidate(); };
  }, [session]);
  return { ...state, reload: session.load, save: session.save };
}

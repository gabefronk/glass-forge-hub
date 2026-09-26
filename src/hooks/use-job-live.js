import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { touchesJob } from "@/lib/jobHistory";

// Live job history: when anyone adds or changes a note, field report or visit
// for this job, reload quietly. Notes alone only need the cheap notes reload.
// scope(): { memberIds, shownIds } for the job on screen right now.
// Returns true when realtime updates are connected.
export function useJobLive(jobId, { scope, reloadNotes, reloadAll }) {
  const [live, setLive] = useState(false);
  const cb = useRef({ scope, reloadNotes, reloadAll });
  cb.current = { scope, reloadNotes, reloadAll };

  useEffect(() => {
    if (!jobId) return undefined;
    let timer = null;
    let full = false;
    const schedule = (needsFull) => {
      full = full || needsFull;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const doFull = full;
        full = false;
        try { await (doFull ? cb.current.reloadAll() : cb.current.reloadNotes()); }
        catch { /* the next change or a reload will catch up */ }
      }, 1200);
    };
    const subs = [];
    const watch = (entity, needsFull) => {
      try {
        const off = base44.entities[entity]?.subscribe?.((event) => {
          const { memberIds, shownIds } = cb.current.scope();
          if (touchesJob(event, memberIds, shownIds)) schedule(needsFull);
        });
        if (typeof off === "function") subs.push(off);
      } catch { /* realtime unavailable: the page still works, just not live */ }
    };
    watch("JobNotes", false);
    watch("FieldReports", true);
    watch("CalendarEvents", true);
    setLive(subs.length > 0);
    // Coming back to the tab (or the phone) after a minute catches anything missed.
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 60000) schedule(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      subs.forEach((off) => { try { off(); } catch { /* ignore */ } });
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [jobId]);

  return live;
}

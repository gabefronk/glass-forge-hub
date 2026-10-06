import { Link } from "react-router-dom";

// Shown when Jobs.create returned no confirmed result. Creating is disabled for
// this session; the user checks the read-only matches or the Jobs list by hand.
export default function UncertainJobCreate({ error, matches = [] }) {
  return (
    <div role="alert" className="mt-3 rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: "#faf0da", color: "#6f4e10", border: "1px solid #efdfb7" }}>
      <div className="font-bold">We could not confirm whether the job was created{error ? ` (${error})` : ""}.</div>
      <div className="mt-1">Creating is turned off for this session so the job isn't duplicated. Your entries are kept. Check the Jobs list before trying again from a new session.</div>
      {matches.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {matches.map(j => (
            <li key={j.id}><Link to={`/jobs/${j.id}`} className="font-semibold underline">{j.canonical_name}</Link>{j.address ? ` · ${j.address}` : ""}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-1">No matching job is visible yet. It may still appear shortly.</div>
      )}
      <Link to="/jobs" className="mt-2 inline-block font-semibold underline">Search existing jobs</Link>
    </div>
  );
}
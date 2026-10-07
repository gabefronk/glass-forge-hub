import { describeReviewed } from "@/lib/jobCalendarValidate";

// Renders the frozen reviewed payload (never the latest job props).
export default function JobCreateEventReview({ payload, heading }) {
  if (!payload) return null;
  return (
    <div className="space-y-2">
      {heading ? <p className="text-[12.5px] font-semibold" style={{ color: "#082f2c" }}>{heading}</p> : null}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {describeReviewed(payload).map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-[8px] px-3 py-1.5" style={{ border: "1px solid #e2dcd1", backgroundColor: "#faf8f3" }}>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[.1em]" style={{ color: "#566063" }}>{k}</dt>
            <dd className="m-0 whitespace-pre-wrap break-words text-[13px]" style={{ color: "#182422" }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
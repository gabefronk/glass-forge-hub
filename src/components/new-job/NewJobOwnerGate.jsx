import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { C } from "@/lib/feeUI";

// Shown instead of the New Job wizard while auth loads or for non-owners, so no
// cost / sale / profit inputs ever render for them.
export default function NewJobOwnerGate({ loading }) {
  return (
    <PageShell width="max-w-[960px]">
      <Link to="/purchasing" className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: C.text }}><ArrowLeft size={14} /> Purchasing</Link>
      {loading ? (
        <div className="flex items-center justify-center py-16" role="status" aria-label="Checking access">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#0b3f3b" }} />
        </div>
      ) : (
        <div className="rounded-[14px] border bg-white p-5" style={{ borderColor: "#e0dacf" }}>
          <div className="flex items-center gap-2"><Lock size={16} style={{ color: "#0b3f3b" }} /><h1 className="m-0 text-[16px] font-bold" style={{ color: "#101617" }}>Owner only</h1></div>
          <p className="mt-2 text-[13px]" style={{ color: "#566063" }}>The new job builder includes cost and sale pricing, so only the owner can use it. To add a job without pricing, use Add job on the Jobs page.</p>
          <Link to="/jobs" className="mt-3 inline-flex min-h-10 items-center rounded-[9px] px-3.5 text-[13px] font-semibold text-white" style={{ backgroundColor: "#0b3f3b" }}>Go to Jobs</Link>
        </div>
      )}
    </PageShell>
  );
}
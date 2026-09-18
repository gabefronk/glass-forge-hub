import { MapPin, Building2, FileText, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { ContactRow, JobContactRows, JobContactSuggestionsRow, Row } from "@/components/jobs/JobContacts";

// jobContacts is the useJobContacts() result: the read-only Jobs ⇄ ContactJobLink ⇄ directory join.
export default function JobFactsRail({ job, jobContacts, plans }) {
  const builder = (jobContacts?.view?.linked || []).filter((c) => c.role === "builder");
  const jobPlans = plans || [];
  const mapHref = job.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null;

  return (
    <div className="rounded-[12px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="px-3.5 py-3 flex items-start gap-2.5">
        <Building2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.textMuted }} />
        <div className="min-w-0">
          <div className="mono-label-sm mb-0.5">Builder</div>
          <div className="text-[14px] font-semibold break-words" style={{ color: C.text }}>{sanitizeText(job.builder || "—")}</div>
          {builder.length > 0 && <div className="mt-1.5 space-y-1.5">{builder.map((c) => <ContactRow key={c.key} contact={c} />)}</div>}
        </div>
      </div>

      <JobContactRows jobId={job.id} jobContacts={jobContacts} />

      {job.address && (
        <Row icon={MapPin} label="Job address">
          {mapHref ? (
            <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5 text-[13px] break-words hover:underline" style={{ color: C.accentText }}>
              <span className="break-words">{sanitizeText(job.address)}</span>
              <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
            </a>
          ) : (
            <span className="text-[13px] break-words" style={{ color: C.text }}>{sanitizeText(job.address)}</span>
          )}
        </Row>
      )}

      {jobPlans.length > 0 && (
        <Row icon={FileText} label="Plans & documents">
          <div className="space-y-1">
            {jobPlans.map((p, i) => {
              // Open the whole plan set (Drive file), not just the first split page.
              const href = p.drive_file_id ? `https://drive.google.com/file/d/${encodeURIComponent(p.drive_file_id)}/view` : p.page_urls?.[0];
              const label = (
                <>
                  <span className="break-words">{sanitizeText(p.file_name) || "Plan document"}</span>
                  {p.page_count > 0 && <span style={{ color: C.textMuted }}>· {p.page_count}p</span>}
                </>
              );
              return href ? (
                <a key={p.id || i} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] py-0.5 break-words hover:underline" style={{ color: C.accentText }}>
                  <ExternalLink className="h-3 w-3 shrink-0" />{label}
                </a>
              ) : (
                <span key={p.id || i} className="inline-flex items-center gap-1.5 text-[12px] py-0.5 break-words" style={{ color: C.textMuted }} title="No file link recorded for this plan">{label}</span>
              );
            })}
          </div>
        </Row>
      )}

      <JobContactSuggestionsRow jobContacts={jobContacts} />
    </div>
  );
}
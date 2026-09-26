import { MapPin, Building2, FileText, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { BuilderContacts, ContactRow, JobContactRows, JobContactSuggestionsRow, Row } from "@/components/jobs/JobContacts";
import JobEventDocuments, { eventAttachments } from "@/components/jobs/JobEventDocuments";
import JobDriveDocuments from "@/components/jobs/JobDriveDocuments";

// jobContacts is the useJobContacts() result: the read-only Jobs ⇄ ContactJobLink ⇄ directory join.
// hideDocuments: the full job page shows plans, folder files and event
// documents in its Plans & photos panel, so the rail skips them there.
// contactsOnly: inside the job sheet's Contacts card (no frame, no address row;
// the hero already shows the address and the files menu shows the documents).
export default function JobFactsRail({ job, jobContacts, plans, events, hideDocuments = false, contactsOnly = false }) {
  const builder = (jobContacts?.view?.linked || []).filter((c) => c.role === "builder");
  // Everyone filed under this job's builder (normalized like Jobs.builder), not just job links.
  const builderPeople = jobContacts?.view?.job?.id === job.id ? jobContacts.view.builder_contacts || [] : [];
  const builderName = jobContacts?.view?.job?.builder || "";
  const jobPlans = plans || [];
  const mapHref = job.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}` : null;

  return (
    <div className={contactsOnly ? "overflow-hidden rounded-b-[14px]" : "rounded-[12px] overflow-hidden card-shadow"} style={contactsOnly ? undefined : { border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="px-3.5 py-3 flex items-start gap-2.5">
        <Building2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.textMuted }} />
        <div className="min-w-0">
          <div className="mono-label-sm mb-0.5">Builder</div>
          <div className="text-[14px] font-semibold break-words" style={{ color: C.text }}>{sanitizeText(job.builder || builderName || "—")}</div>
          {builderName && builderName.toLowerCase() !== String(job.builder || "").toLowerCase() && <div className="text-[11px]" style={{ color: C.textFaint }}>Contacts filed as {sanitizeText(builderName)}</div>}
          {builder.length > 0 && <div className="mt-1.5 space-y-1.5">{builder.map((c) => <ContactRow key={c.key} contact={c} />)}</div>}
          <BuilderContacts contacts={builderPeople} jobId={job.id} />
        </div>
      </div>

      <JobContactRows jobId={job.id} jobContacts={jobContacts} />

      {!hideDocuments && eventAttachments(events).length > 0 && (
        <Row icon={FileText} label="Event documents">
          <JobEventDocuments events={events} />
        </Row>
      )}

      {job.address && !contactsOnly && (
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

      {!hideDocuments && <JobDriveDocuments job={job} />}

      {!hideDocuments && jobPlans.length > 0 && (
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

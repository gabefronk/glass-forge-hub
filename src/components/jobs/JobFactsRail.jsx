import React from "react";
import { base44 } from "@/api/base44Client";
import { MapPin, Building2, FileText, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { ContactRow, JobContactRows, JobContactSuggestionsRow, Row } from "@/components/jobs/JobContacts";
import JobEventDocuments, { eventAttachments } from "@/components/jobs/JobEventDocuments";

// jobContacts is the useJobContacts() result: the read-only Jobs ⇄ ContactJobLink ⇄ directory join.
function JobDriveDocuments({ job }) {
  const [result,setResult]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  React.useEffect(()=>{if(!job.drive_job_folder_id){setResult(null);return;}let active=true;setBusy(true);base44.functions.invoke('job-documents',{action:'list',job_id:job.id}).then(r=>{if(active){if(r.data?.error)throw Error(r.data.error);setResult(r.data);setError('');}}).catch(e=>{if(active)setError(e.message||'Drive files unavailable.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false};},[job.id,job.drive_job_folder_id]);
  if(!job.drive_job_folder_id)return null;
  return <Row icon={FileText} label="Drive job folder"><div className="space-y-2 text-xs"><p><a href={result?.folder?.url||job.drive_job_folder_url} target="_blank" rel="noreferrer" className="underline">Open verified job folder</a></p>{busy&&<p>Loading current files…</p>}{error&&<p role="alert">{error}</p>}{result?.files?.length>0&&<ul className="space-y-1">{result.files.map(f=><li key={f.id}><a className="break-all underline" href={f.url} target="_blank" rel="noreferrer">{sanitizeText(f.name)}</a></li>)}</ul>}{result&&!result.files.length&&<p>No files in this folder's top level.</p>}{result&&!result.complete&&<p>File list is partial. Open the folder for the full set.</p>}</div></Row>;
}
export default function JobFactsRail({ job, jobContacts, plans, events }) {
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

      {eventAttachments(events).length > 0 && (
        <Row icon={FileText} label="Event documents">
          <JobEventDocuments events={events} />
        </Row>
      )}

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

      <JobDriveDocuments job={job} />

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
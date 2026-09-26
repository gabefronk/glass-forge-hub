import { Image as ImageIcon, FolderOpen, ExternalLink } from "lucide-react";
import { C, formatShort } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { splitFolderFiles } from "@/lib/jobHistory";
import JobEventDocuments, { eventAttachments } from "@/components/jobs/JobEventDocuments";
import FeedImage from "@/components/jobs/FeedImage";

const day = (v) => (v ? formatShort(String(v).slice(0, 10)) : "");

function PlanRow({ href, name, meta }) {
  const inner = (
    <>
      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md text-[9px] font-bold" style={{ backgroundColor: "#FCEDEC", color: "#A43432" }}>PDF</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold break-words" style={{ color: C.text }}>{sanitizeText(name)}</span>
        {meta ? <span className="block text-[11.5px]" style={{ color: C.textMuted }}>{meta}</span> : null}
      </span>
      {href ? <ExternalLink className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} /> : null}
    </>
  );
  const cls = "flex items-center gap-3 rounded-[10px] px-2.5 py-2 min-h-[52px]";
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:bg-black/[0.03]`}>{inner}</a>
    : <div className={cls} title="No file link recorded for this plan">{inner}</div>;
}

// Plans & photos for the crew: everything they need to see before calling
// anyone. Reads from the existing connectors only (Drive folder listing,
// PlanIntake, calendar attachments, field-report photos).
// bare: no card around it (inside the Jobs workspace, which is already a white panel).
export default function JobPlansPhotos({ folder, plans, events, sitePhotos, onPhotoClick, bare = false }) {
  const label = "mb-1.5 text-[12.5px] font-semibold";
  const { plans: folderPlans, photos: folderPhotos, other } = splitFolderFiles(folder.files);
  const intake = (plans || []).map((p) => ({
    key: `pi-${p.id}`,
    href: p.drive_file_id ? `https://drive.google.com/file/d/${encodeURIComponent(p.drive_file_id)}/view` : p.page_urls?.[0],
    name: p.file_name || "Plan document",
    meta: p.page_count > 0 ? `${p.page_count} pages` : "Plan set",
  }));
  const planRows = [
    ...folderPlans.map((f) => ({ key: f.id, href: f.url, name: f.name, meta: `Job folder${f.modified_at ? ` · ${day(f.modified_at)}` : ""}` })),
    ...intake.filter((p) => !folderPlans.some((f) => f.name === p.name)),
    ...other.map((f) => ({ key: f.id, href: f.url, name: f.name, meta: "Job folder" })),
  ];
  const hasEventDocs = eventAttachments(events, { skipJobFolder: !!folder.folder }).length > 0;
  const photoCount = (sitePhotos || []).length + folderPhotos.length;

  return (
    <section aria-labelledby="plans-photos-heading" className={bare ? "" : "mb-6 rounded-[14px] p-4"} style={bare ? undefined : { border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 id="plans-photos-heading" className={bare ? "m-0 text-[13px] font-bold" : "font-heading text-[18px] font-bold"} style={{ color: bare ? "#566063" : C.text }}>Plans &amp; photos</h2>
        {folder.folder?.url ? (
          <a href={folder.folder.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-h-[32px] rounded-full px-3 text-[12px] font-semibold" style={{ border: `1px solid ${C.border}`, color: C.accentText }}>
            <FolderOpen className="h-3.5 w-3.5" />Open job folder
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className={label} style={{ color: C.textSecondary }}>Plans &amp; documents · {planRows.length}</div>
          {folder.loading && !planRows.length ? <p className="text-[12px]" style={{ color: C.textMuted }}>Loading job folder…</p> : null}
          {planRows.length ? (
            <div className="-mx-2.5">{planRows.map((p) => <PlanRow key={p.key} href={p.href} name={p.name} meta={p.meta} />)}</div>
          ) : !folder.loading ? (
            <p className="rounded-[10px] border border-dashed p-3 text-[12.5px]" style={{ borderColor: C.border, color: C.textMuted }}>
              {folder.folder ? "No plans in the job folder yet. Drop the plan set into the folder and it shows up here." : "No job folder linked yet, so there are no plans to show."}
            </p>
          ) : null}
          {!folder.complete ? <p className="mt-1 text-[11px]" style={{ color: C.textMuted }}>Showing part of the folder. Open it for everything.</p> : null}
          {folder.error ? <p role="alert" className="mt-1 text-[11.5px]" style={{ color: "#A43432" }}>{folder.error}</p> : null}
          {hasEventDocs ? (
            <div className="mt-3">
              <div className={label} style={{ color: C.textSecondary }}>From calendar events</div>
              <JobEventDocuments events={events} skipJobFolder={!!folder.folder} />
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className={label} style={{ color: C.textSecondary }}>Site photos · {photoCount}</div>
          {photoCount ? (
            <div className="grid grid-cols-3 gap-1.5">
              {(sitePhotos || []).map((p) => (
                <button key={p.url} type="button" onClick={() => onPhotoClick(p.url)} className="relative aspect-square overflow-hidden rounded-[8px]" style={{ border: `1px solid ${C.border}` }} aria-label={`Site photo from ${day(p.date)}`}>
                  <FeedImage src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[10px] text-white">{day(p.date)}</span>
                </button>
              ))}
              {folderPhotos.map((f) => (
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[8px] p-1.5 text-center" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }} title={f.name}>
                  <ImageIcon className="h-4 w-4" style={{ color: C.textMuted }} />
                  <span className="line-clamp-2 break-all text-[10px]" style={{ color: C.textSecondary }}>{sanitizeText(f.name)}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="rounded-[10px] border border-dashed p-3 text-[12.5px]" style={{ borderColor: C.border, color: C.textMuted }}>
              No photos yet. Photos from field reports show up here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

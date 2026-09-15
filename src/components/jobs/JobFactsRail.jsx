import { Phone, Mail, MapPin, Building2, User, FileText, ExternalLink, HardHat } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";

function qualifierOf(contact) {
  const builder = contact.builder || "";
  const company = contact.company || "";
  if (builder && company.startsWith(builder)) {
    return company.slice(builder.length).replace(/^\s*[-–—:]\s*/, "").trim();
  }
  return company;
}

const PM_RE = /\b(pm|superintendent|project manager|construction manager|field manager|lead)\b/i;
const HOMEOWNER_RE = /\b(homeowner|home owner|owner|buyer|customer|resident)\b/i;

function classify(contacts) {
  const builder = [], pm = [], homeowner = [], site = [];
  for (const c of contacts || []) {
    const q = qualifierOf(c);
    if (!q) builder.push(c);
    else if (PM_RE.test(q)) pm.push(c);
    else if (HOMEOWNER_RE.test(q)) homeowner.push(c);
    else site.push(c);
  }
  return { builder, pm, homeowner, site };
}

function ContactRow({ contact }) {
  const phone = contact.phone;
  const email = contact.email;
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-medium break-words" style={{ color: C.text }}>{sanitizeText(contact.name)}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
        {phone && (
          <a href={`tel:${String(phone).replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-[12px] py-0.5 break-words hover:underline" style={{ color: C.accentText }}>
            <Phone className="h-3 w-3 shrink-0" />{phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="inline-flex items-center gap-1 text-[12px] py-0.5 break-all hover:underline" style={{ color: C.accentText }}>
            <Mail className="h-3 w-3 shrink-0" />{email}
          </a>
        )}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5" style={{ borderTop: `1px solid ${C.rowBorder}` }}>
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: C.textMuted }} />
      <div className="min-w-0 flex-1">
        <div className="mono-label-sm mb-1">{label}</div>
        {children}
      </div>
    </div>
  );
}

export default function JobFactsRail({ job, contacts, plans }) {
  const { builder, pm, homeowner, site } = classify(contacts);
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

      {pm.length > 0 && (
        <Row icon={HardHat} label="Project manager">
          <div className="space-y-1.5">{pm.map((c) => <ContactRow key={c.key} contact={c} />)}</div>
        </Row>
      )}

      {homeowner.length > 0 && (
        <Row icon={User} label="Homeowner">
          <div className="space-y-1.5">{homeowner.map((c) => <ContactRow key={c.key} contact={c} />)}</div>
        </Row>
      )}

      {site.length > 0 && (
        <Row icon={User} label="Site contact">
          <div className="space-y-1.5">{site.map((c) => <ContactRow key={c.key} contact={c} />)}</div>
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

      {jobPlans.length > 0 && (
        <Row icon={FileText} label="Plans & documents">
          <div className="space-y-1">
            {jobPlans.map((p, i) => (
              <a key={i} href={p.page_urls?.[0] || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] py-0.5 break-words hover:underline" style={{ color: C.accentText }}>
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="break-words">{sanitizeText(p.file_name)}</span>
                {p.page_count > 0 && <span style={{ color: C.textMuted }}>· {p.page_count}p</span>}
              </a>
            ))}
          </div>
        </Row>
      )}
    </div>
  );
}
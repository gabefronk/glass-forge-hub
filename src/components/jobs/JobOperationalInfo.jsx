import { Phone, Mail, MapPin, Building2, User, FileText, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";

function ContactRow({ contact }) {
  const hasContact = contact.phone || contact.email;
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[13px] font-medium break-words" style={{ color: C.text }}>{contact.name}</span>
      {contact.company && contact.company !== contact.builder && (
        <span className="text-[11px] break-words" style={{ color: C.textMuted }}>{contact.company}</span>
      )}
      {hasContact && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 text-[12px] min-h-[32px] py-1 break-words" style={{ color: C.accentText }}>
              <Phone className="h-3 w-3 shrink-0" />{contact.phone}
            </a>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 text-[12px] min-h-[32px] py-1 break-all" style={{ color: C.accentText }}>
              <Mail className="h-3 w-3 shrink-0" />{contact.email}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3" style={{ borderTop: `1px solid ${C.rowBorder}` }}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.textMuted }} />
      <div className="min-w-0 flex-1">
        <div className="mono-label-sm mb-1.5">{label}</div>
        {children}
      </div>
    </div>
  );
}

export default function JobOperationalInfo({ job, contacts, plans }) {
  const builderContacts = (contacts || []).filter((c) => c.company && c.builder && c.company === c.builder);
  const siteContacts = (contacts || []).filter((c) => !(c.company && c.builder && c.company === c.builder));
  const jobPlans = plans || [];

  return (
    <div className="rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      {/* Builder name + contact */}
      <div className="flex items-start gap-3 py-3">
        <Building2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.textMuted }} />
        <div className="min-w-0 flex-1">
          <div className="mono-label-sm mb-1.5">Builder</div>
          <div className="text-[14px] font-semibold break-words" style={{ color: C.text }}>{job.builder || "—"}</div>
          {builderContacts.length > 0 && (
            <div className="mt-2 space-y-2">
              {builderContacts.map((c) => <ContactRow key={c.key} contact={c} />)}
            </div>
          )}
        </div>
      </div>

      {/* Address */}
      {job.address && (
        <Section icon={MapPin} label="Job address">
          <span className="text-[13px] break-words" style={{ color: C.text }}>{job.address}</span>
        </Section>
      )}

      {/* Plans / documents */}
      {jobPlans.length > 0 && (
        <Section icon={FileText} label="Construction plans & documents">
          <div className="space-y-1.5">
            {jobPlans.map((p, i) => (
              <a
                key={i}
                href={p.page_urls?.[0] || "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] min-h-[32px] py-1 break-words hover:underline"
                style={{ color: C.accentText }}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="break-words">{p.file_name}</span>
                {p.page_count > 0 && <span style={{ color: C.textMuted }}>· {p.page_count}p</span>}
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Homeowner / site contact */}
      {siteContacts.length > 0 && (
        <Section icon={User} label="Site / homeowner contact">
          <div className="space-y-2">
            {siteContacts.map((c) => <ContactRow key={c.key} contact={c} />)}
          </div>
        </Section>
      )}
    </div>
  );
}
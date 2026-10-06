// Read-only view of the frozen send plan: each step's exact content and outcome.
const LABEL = {
  sent: 'Sent',
  failed_pre_dispatch: 'Not sent (can retry)',
  unknown: 'Outcome unknown',
  rejected: 'Refused (already attempted)',
  disabled: 'Sending disabled',
};

export default function SendPlanStatus({ plan }) {
  if (!plan) return null;
  return (
    <ol className="mb-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs" aria-label="Send progress">
      {plan.steps.map((s) => (
        <li key={s.client_id} className="flex items-start justify-between gap-3">
          <span className="min-w-0 whitespace-pre-wrap break-words text-slate-700 [overflow-wrap:anywhere]">
            {s.kind === 'send_attachment' ? `Attachment: ${s.payload.name}` : s.payload.text}
          </span>
          <span className="shrink-0 font-medium text-slate-500">{s.result ? LABEL[s.result.status] || 'Outcome unknown' : 'Waiting'}</span>
        </li>
      ))}
    </ol>
  );
}
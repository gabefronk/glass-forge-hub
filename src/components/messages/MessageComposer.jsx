import { forwardRef, useCallback, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAgentCenterOwner } from '@/lib/agentCenterAccess';
import { stageFile, freezeBatch, canSend, revokePreviews, TEXT_MAX } from '@/lib/messageComposerState';
import { runSendBatch } from '@/lib/messageComposerOrchestration';
import { Paperclip, X, Loader2, Send, LockKeyhole } from 'lucide-react';

const invoke = (data) => base44.functions.invoke('messages-send', data).then((r) => r.data);

async function sha256File(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeInvokeError(e) {
  const data = e?.response?.data || e?.data || {};
  const code = data.code || e?.code;
  const status = code === 'rejected' ? 'rejected'
    : code === 'failed_pre_dispatch' ? 'failed_pre_dispatch'
    : code === 'disabled' ? 'disabled'
    : 'unknown';
  return { status, error: data.error || e?.message || 'Send outcome is unknown.' };
}

// Owner-only composer. Stages raw Files locally (NO upload on drop) with image previews; on Send
// it freezes the batch, then sequentially uploads -> registers -> sends each attachment, then the
// text. An uncertain (unknown/rejected/disabled) step LOCKS the batch: following steps are not sent
// and the UI stays locked until reconciliation. The parent keys this component by conversation+user
// so switching conversations mounts a fresh instance; an unmounted async never touches new state.
const MessageComposer = forwardRef(function MessageComposer({ conversationKey }, ref) {
  const { user } = useAuth();
  const owner = isAgentCenterOwner(user);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const filesRef = useRef(files);
  filesRef.current = files;
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      revokePreviews(filesRef.current);
    };
  }, []);

  const addFiles = useCallback((incoming) => {
    if (sending || locked || !owner) return;
    const staged = [];
    const errs = [];
    for (const f of incoming) {
      const r = stageFile(f);
      if (r.ok) staged.push(r.item); else errs.push(r.error);
    }
    if (errs.length) setError(errs.join(' '));
    if (staged.length) setFiles((prev) => [...prev, ...staged]);
  }, [sending, locked, owner]);

  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

  const removeFile = useCallback((id) => {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const handleSend = async () => {
    if (!conversationKey || !owner || sending || locked) return;
    if (!canSend({ text, files, sending, locked })) return;
    setSending(true);
    setError('');
    const batch = freezeBatch({ conversationKey, text, files });
    const deps = {
      uploadFile: (file) => base44.integrations.Core.UploadPrivateFile({ file }).then((r) => ({ file_uri: r.file_uri })),
      sha256File,
      registerUpload: (r) => invoke({ action: 'register_upload', ...r }).then(() => ({}), (e) => { throw normalizeInvokeError(e); }),
      sendText: (r) => invoke({ action: 'send_text', ...r }).then((res) => ({ status: 'sent', ...res }), normalizeInvokeError),
      sendAttachment: (r) => invoke({ action: 'send_attachment', ...r }).then((res) => ({ status: 'sent', ...res }), normalizeInvokeError),
    };
    let outcome;
    try {
      outcome = await runSendBatch(batch, deps);
    } catch (e) {
      outcome = { locked: true, allSent: false, error: e?.message || 'Send failed.' };
    }
    if (!activeRef.current) return; // unmounted (conversation/user switched): never touch new state
    setSending(false);
    if (outcome.locked) setLocked(true);
    if (outcome.error) setError(outcome.error);
    if (outcome.allSent) {
      revokePreviews(filesRef.current);
      setFiles([]);
      setText('');
    }
  };

  if (!owner) return null; // guard owner id in the component itself

  const busy = sending;
  const frozen = busy || locked;
  const disabled = frozen || !canSend({ text, files, sending, locked });
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5 pr-2">
              {f.isImage && f.previewUrl ? (
                <img src={f.previewUrl} alt={f.name} className="h-10 w-10 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-200"><Paperclip className="h-4 w-4 text-slate-500" /></div>
              )}
              <span className="max-w-[140px] truncate text-xs text-slate-700">{f.name}</span>
              <button type="button" onClick={() => removeFile(f.id)} disabled={frozen} aria-label={`Remove ${f.name}`} className="rounded-full p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSend(); }}
        onPaste={(e) => {
          const items = Array.from(e.clipboardData?.items || []);
          const pasted = items.filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
          if (pasted.length) { e.preventDefault(); addFiles(pasted); }
        }}
        disabled={frozen}
        placeholder={locked ? 'Send stopped. Reconcile on the Mac before sending again.' : 'Type a message… (Cmd/Ctrl+Enter to send)'}
        rows={2}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-sm focus:outline-none disabled:bg-slate-50"
      />
      <div className="mt-2 flex items-center gap-2">
        <label className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 ${frozen ? 'pointer-events-none opacity-50' : ''}`}>
          <input type="file" multiple className="hidden" disabled={frozen} onChange={(e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; }} />
          <Paperclip className="h-3.5 w-3.5" /> Attach
        </label>
        <button type="button" onClick={handleSend} disabled={disabled} className="ml-auto flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--gf-teal-600)] px-4 text-sm font-medium text-white hover:bg-[var(--gf-teal-700)] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? <LockKeyhole className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {busy ? 'Sending…' : locked ? 'Locked' : 'Send'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {locked && <p className="mt-2 text-xs text-amber-800">A send has an unknown outcome. Reconcile on the Mac before sending again.</p>}
    </div>
  );
});

export default MessageComposer;
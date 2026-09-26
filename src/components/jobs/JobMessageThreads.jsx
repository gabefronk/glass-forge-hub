import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {LockKeyhole,MessageSquare,RefreshCw} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';
import {isAgentCenterOwner} from '@/lib/agentCenterAccess';
import {sanitizeText} from '@/lib/jobsSanitize';

const stamp=value=>value?new Date(value).toLocaleString():'';

export default function JobMessageThreads({jobId}){
 const {user}=useAuth(),owner=isAgentCenterOwner(user);
 const [state,setState]=useState({loading:true,data:null,error:''});
 const load=()=>{if(!owner)return;setState(s=>({...s,loading:true,error:''}));base44.functions.invoke('messages-bridge',{action:'job_threads',job_id:jobId}).then(r=>setState({loading:false,data:r.data,error:''})).catch(()=>setState({loading:false,data:null,error:'Message threads could not be loaded.'}));};
 useEffect(()=>{load()},[jobId,owner]);
 if(!owner)return null;
 const threads=state.data?.threads||[];
 return <section aria-labelledby="job-message-heading" className="mt-5 rounded-[14px] border border-[var(--gf-border)] bg-white p-4 card-shadow">
  <div className="flex items-start justify-between gap-3"><div><h2 id="job-message-heading" className="flex items-center gap-2 text-[16px] font-semibold text-[var(--gf-ink)]"><MessageSquare className="h-4 w-4"/>Private message threads</h2><p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--gf-ink-3)]"><LockKeyhole className="h-3 w-3"/>Owner only · read-only copies from Messages Inbox</p></div><button type="button" onClick={load} disabled={state.loading} aria-label="Refresh message threads" className="rounded-full border p-2 text-[var(--gf-ink-2)] disabled:opacity-50"><RefreshCw className={'h-4 w-4 '+(state.loading?'animate-spin':'')}/></button></div>
  {state.error&&<p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
  {!state.loading&&!state.error&&!threads.length&&<p className="mt-3 text-sm text-[var(--gf-ink-2)]">No confirmed message threads are linked to this job.</p>}
  <div className="mt-3 space-y-3">{threads.map(({conversation,messages,provenance})=><article key={conversation.conversation_key} className="rounded-lg border border-[var(--gf-border)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-[var(--gf-ink)]">{sanitizeText(conversation.title||'Messages')}</h3><p className="text-[11px] text-[var(--gf-ink-3)]">{provenance.label} · {stamp(conversation.last_message_at)}</p></div><Link className="text-xs font-medium text-[var(--gf-teal-600)] underline" to={`/messages?view=inbox&job=${encodeURIComponent(jobId)}&conversation=${encodeURIComponent(conversation.conversation_key)}`}>Open in Inbox</Link></div><ol className="mt-2 space-y-1">{[...messages].reverse().map(message=><li key={message.id} className="text-xs text-[var(--gf-ink-2)]"><span className="font-medium">{message.direction==='outgoing'?'You':sanitizeText(message.sender||'Contact')}:</span> {sanitizeText(message.text)|| (message.attachments?.length?'Attachment':'Message unavailable')}</li>)}</ol></article>)}</div>
  {!!state.data?.review_count&&<p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{state.data.review_count} ambiguous {state.data.review_count===1?'thread needs':'threads need'} owner review in Messages Inbox. No job assignment was guessed.</p>}
 </section>;
}

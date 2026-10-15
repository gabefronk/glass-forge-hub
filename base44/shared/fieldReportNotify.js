// Text Gabe when a crew member files a field report - a Hub app upload (resolveFieldReport)
// or a ProBuild post the sync just ingested (fetchProbuildPosts). iMessage through his
// BlueBubbles server (the same lane service items use for Milan). Needs the
// BLUEBUBBLES_PASSWORD secret. Fire-and-forget: a failed text must never break a report,
// so callers wrap the call in try/catch.
import { secrets } from 'base44:runtime';

const BB_URL = 'https://bluebubbles.gfglassforge.com';
// Gabe's iPhone. The BlueBubbles server runs on his Mac, so the text arrives from his
// own number (self-iMessage) - the only outbound iMessage route the Hub has.
const GABE_PHONE = '+18018343421';

const secret = (name) => { try { return secrets.get(name) || Deno.env.get(name) || ''; } catch { try { return Deno.env.get(name) || ''; } catch { return ''; } } };

const firstLine = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';

export async function textGabeFieldReport({ jobName, completion, note, author }) {
  const pw = secret('BLUEBUBBLES_PASSWORD');
  if (!pw) { console.log('fieldReportNotify: BLUEBUBBLES_PASSWORD not set, text skipped'); return false; }
  const status = completion === 'incomplete' ? ' - INCOMPLETE' : completion === 'complete' ? ' - complete' : '';
  const line = firstLine(note);
  const text = [
    `Field report: ${jobName || 'job'}${status}`,
    line ? `"${line}"` : '',
    author ? `- ${author}` : '',
  ].filter(Boolean).join('\n').slice(0, 400);
  try {
    const r = await fetch(`${BB_URL}/api/v1/message/text?password=${encodeURIComponent(pw)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatGuid: `iMessage;-;${GABE_PHONE}`, tempGuid: `fr-${crypto.randomUUID()}`, message: text, method: 'apple-script' }),
    });
    if (!r.ok) throw new Error(`bluebubbles_${r.status}`);
    return true;
  } catch (e) {
    console.log(`fieldReportNotify: text to Gabe failed: ${e?.message || e}`);
    return false;
  }
}

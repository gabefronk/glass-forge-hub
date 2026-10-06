import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const path = new URL('../base44/shared/reportMatching.ts', import.meta.url);
const source = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { hasVerifiedMatchedPosts } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const events = [
  { event_date:'2026-09-17', job_name:'YA - #1 (l.i) Pulte Bldg. 6 Unit 84 The Peaks', report_status:'ok', match_method:'auto-reconcile', matched_post_ids:['peaks'] },
  ...['403','421','422'].map(n => ({ event_date:'2026-09-16', job_name:`Holmes Homes - ${n} Oquirrh West`, report_status:'ok', match_method:'auto-reconcile', matched_post_ids:[n] })),
];
const reports = [
  { post_id:'peaks', job_date:'2026-09-17', job_name:events[0].job_name, message:'Window work complete', attachment_count:1 },
  ...events.slice(1).map(e => ({ post_id:e.matched_post_ids[0], job_date:'2026-09-15', job_name:e.job_name, message:'Photos uploaded', attachment_count:1 })),
];
test('four verified report links survive a forced month audit even when group claiming would lose them', () => {
  for (const e of events) assert.equal(hasVerifiedMatchedPosts(e,reports,'2026-09-25'),true,e.job_name);
});
test('missing, unverified, future, unrelated and incomplete posts cannot lock an ok status', () => {
  const e=events[1];
  assert.equal(hasVerifiedMatchedPosts(e,[], '2026-09-25'),false);
  assert.equal(hasVerifiedMatchedPosts(e,[{...reports[1],job_name:'Other job'}], '2026-09-25'),false);
  assert.equal(hasVerifiedMatchedPosts(e,[{...reports[1],job_date:'2026-09-26'}], '2026-09-25'),false);
  assert.equal(hasVerifiedMatchedPosts(e,[{...reports[1],job_date:'2026-09-12'}], '2026-09-25'),false);
  assert.equal(hasVerifiedMatchedPosts(e,[{...reports[1],message:'',attachment_count:0}], '2026-09-25'),false);
  assert.equal(hasVerifiedMatchedPosts({...e,report_status:'missing_all'},reports,'2026-09-25'),false);
});
test('audit reads the verification guard even under force and no-source branches', async () => {
  const audit=await readFile(new URL('../base44/functions/auditFieldReports/entry.ts', import.meta.url),'utf8');
  assert.match(audit,/const hasVerifiedEvidence = \(event\) => hasVerifiedMatchedPosts\(event, allReports, todayDenver\)/);
  assert.match(audit,/e\.report_status !== 'superseded' && !hasVerifiedEvidence\(e\)/);
  assert.match(audit,/if \(hasVerifiedEvidence\(e\)\) return false;/);
});

async function compiledUrl(url) {
  if (!url.pathname.endsWith('.ts')) return url.href;
  let text=await readFile(url,'utf8');
  for(const match of [...text.matchAll(/from ['"](\.[^'"]+)['"]/g)]) text=text.replace(match[0], 'from '+JSON.stringify(await compiledUrl(new URL(match[1],url))));
  return 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
}
const entity=(rows=[])=>({rows:structuredClone(rows),list:async(_sort,limit=1000,skip=0)=>structuredClone(rows.slice(skip,skip+limit)),bulkUpdate:async function(patches){for(const p of patches)Object.assign(this.rows.find(x=>x.id===p.id),p);return patches;},bulkCreate:async function(patches){this.rows.push(...patches);return patches;}});
test('forced month audit leaves verified ok event unchanged rather than clearing its linked post',async()=>{
  const ev=entity([ {id:'verified',...events[1]} ]), rp=entity(reports), au=entity(), settings=entity();
  const client={auth:{me:async()=>null},asServiceRole:{entities:{CalendarEvents:ev,FieldReports:rp,ReportAudit:au,AppSettings:settings}}};
  let text=await readFile(new URL('../base44/functions/auditFieldReports/entry.ts',import.meta.url),'utf8');
  text=text.replace(/import \{ createClientFromRequest \} from [^;]+;/,'const createClientFromRequest=()=>globalThis.__auditGuardClient;');
  const url=new URL('../base44/functions/auditFieldReports/entry.ts',import.meta.url);
  for(const match of [...text.matchAll(/from ['"](\.\.\/[^'"]+)['"]/g)])text=text.replace(match[0],'from '+JSON.stringify(await compiledUrl(new URL(match[1],url))));
  globalThis.__auditGuardClient=client;
  const run=(await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))).default;
  const result=await run(new Request('https://test/',{method:'POST',body:JSON.stringify({start_date:'2026-09-01',end_date:'2026-09-30',force:true})}));
  assert.equal(result.status,200,await result.text());
  assert.equal(ev.rows[0].report_status,'ok');
  assert.deepEqual(ev.rows[0].matched_post_ids,['403']);
  assert.equal(au.rows.some(x=>x.calendar_event_id==='verified'),false);
});

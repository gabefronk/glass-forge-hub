import test from 'node:test';
import assert from 'node:assert/strict';
import { createTodoHandler } from '../base44/shared/todoService.mjs';

function searchHarness({ owner = false, signedIn = true, linked = true, jobs = [], tasks = [] } = {}) {
  const queries = [];
  const member = { id: owner ? 'mg' : 'mi', member_key: owner ? 'gabriel' : 'israel', active: true, auth_user_ids: ['user'] };
  function match(row, q) {
    return Object.entries(q).every(([k, v]) => {
      if (k === '$or') return v.some(p => match(row, p));
      const value = row[k];
      if (v && typeof v === 'object') return Object.entries(v).every(([op, arg]) => {
        if (op === '$regex') return new RegExp(arg, v.$options || '').test(String(value || ''));
        if (op === '$options') return true;
        if (op === '$ne') return value !== arg;
        if (op === '$exists') return (value !== undefined) === arg;
        if (op === '$in') return arg.includes(value);
        throw new Error('Unhandled operator ' + op);
      });
      return value === v || (v === null && value === undefined);
    });
  }
  const entities = {
    TeamMember: { list: async () => linked ? [member] : [] },
    TodoTask: { filter: async q => tasks.filter(t => match(t, q)) },
    Jobs: { filter: async (q, sort, limit, skip) => { queries.push({ q, limit, skip }); return jobs.filter(j => match(j, q)).sort((a,b) => a.canonical_name.localeCompare(b.canonical_name)).slice(skip, skip+limit); } },
  };
  const handler = createTodoHandler({ getClient: async () => ({ auth: { me: async () => signedIn ? {id:'user'} : null }, asServiceRole: {entities} }), isOwner: () => owner });
  return { queries, call: async query => { const r = await handler(new Request('https://test.local', {method:'POST', body:JSON.stringify({action:'search_jobs',query})})); return {status:r.status, body:await r.json()}; } };
}

test('job search empty and invalid queries do not dump jobs', async () => {
 const h=searchHarness({owner:true});assert.deepEqual((await h.call('  ')).body.jobs,[]);assert.equal(h.queries.length,0);
 for(const q of ['x'.repeat(121),{$regex:'.*'},['name'],42])assert.equal((await h.call(q)).status,400);
 assert.equal(h.queries.length,0);
});

test('owner job search escapes every regex metacharacter and finds beyond an initial page',async()=>{
 const literal='House [A].*+$?(){}|^\\';const h=searchHarness({owner:true,jobs:[...Array.from({length:510},(_,i)=>({id:'old'+i,canonical_name:'A old '+i})),{id:'target',canonical_name:literal,stage:'quoted',private_cost:900}]});
 const r=await h.call(literal);assert.equal(r.status,200);assert.deepEqual(r.body.jobs,[{id:'target',canonical_name:literal,stage:'quoted'}]);assert.equal(h.queries[0].q.canonical_name.$options,'i');assert.equal(h.queries[0].limit,31);
 const broad=await h.call('.*');assert.deepEqual(broad.body.jobs.map(j=>j.id),['target']);
});

test('crew job search is limited to exact pm or existing active task authorization',async()=>{
 const jobs=[{id:'own',canonical_name:'Match Own',pm_member_key:'israel'},{id:'linked',canonical_name:'Match Linked',pm_member_key:'other'},{id:'other',canonical_name:'Match Other',pm_member_key:'israel-other'}];
 const h=searchHarness({jobs,tasks:[{id:'t',assignee_member_id:'mi',archived_at:'',status:'open',job_id:'linked'}]});
 const r=await h.call('match');assert.equal(r.status,200);assert.deepEqual(r.body.jobs.map(j=>j.id),['linked','own']);assert.equal((await h.call('Other')).body.jobs.length,0);
});

test('job search excludes merged sample and Renta records; limits output',async()=>{
 const jobs=[...Array.from({length:32},(_,i)=>({id:'j'+i,canonical_name:'Target '+i})),{id:'merged',canonical_name:'Target merged',merged_into:'main'},{id:'sample',canonical_name:'Target sample',is_sample:true},{id:'rent',canonical_name:'Renta'}];
 const h=searchHarness({owner:true,jobs});const r=await h.call('Target');assert.equal(r.body.jobs.length,30);assert.equal(r.body.truncated,true);assert.ok(!r.body.jobs.some(j=>['merged','sample'].includes(j.id)));assert.deepEqual((await h.call('Renta')).body.jobs,[]);
});

test('anonymous and unlinked callers cannot search',async()=>{
 for(const options of [{signedIn:false},{linked:false}]){const h=searchHarness(options);assert.ok((await h.call('private')).status>=400);assert.equal(h.queries.length,0);}
});

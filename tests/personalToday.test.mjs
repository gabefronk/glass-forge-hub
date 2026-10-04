import test from 'node:test';
import assert from 'node:assert/strict';
import {personalTaskViews,filterPersonalTasks,isForToday,initialPersonalView} from '../src/lib/personalToday.js';
const today='2026-10-04';
const task=(id,fields={})=>({id,title:id,status:'open',...fields});
test('legacy redirect chooses All without accepting arbitrary view names',()=>{
 assert.equal(initialPersonalView('?view=all'),'all');
 assert.equal(initialPersonalView('?view=unknown'),'today');
 assert.equal(initialPersonalView(''),'today');
});
test('capture without deadline stays in Inbox, while planned and actual deadlines surface Today',()=>{
 const rows=[task('loose'),task('focused',{focus_date:today}),task('overdue',{due_date:'2026-10-01'}),task('working',{status:'in_progress'}),task('later',{focus_date:'2026-10-07'})];
 const v=personalTaskViews(rows,today);
 assert.deepEqual(v.inbox.map(t=>t.id),['loose']);
 assert.deepEqual(new Set(v.today.map(t=>t.id)),new Set(['focused','overdue','working']));
 assert.equal(v.today[0].id,'overdue');
 assert.deepEqual(v.upcoming.map(t=>t.id),['later']);
 assert.equal(v.all.length,5);
 assert.equal(rows[0].due_date,undefined);
});
test('waiting hides planned work until follow-up, but never conceals a real due deadline',()=>{
 const rows=[task('waiting',{waiting_on:'Glass',focus_date:today,status:'in_progress'}),task('future',{waiting_on:'Israel',follow_up_date:'2026-10-09'}),task('check',{waiting_on:'Customer',follow_up_date:today}),task('overdue',{waiting_on:'Supplier',follow_up_date:'2026-10-09',due_date:'2026-10-03'})];
 const v=personalTaskViews(rows,today);
 assert.equal(v.waiting.length,4);assert.equal(v.inbox.length,0);
 assert.deepEqual(v.today.map(t=>t.id),['overdue','check']);
 assert.deepEqual(v.upcoming.map(t=>t.id),['future']);
});
test('all active records retained; done and archived stay out; search can find waiting details',()=>{
 const rows=[task('a',{category:'odd_end',details:'Door handle'}),task('b',{waiting_on:'Israel'}),task('old',{archived_at:'2026-10-01'}),task('done',{status:'done'})];
 const before=JSON.stringify(rows),v=personalTaskViews(rows,today);
 assert.equal(v.all.length,2);assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(filterPersonalTasks(v.all,' israel ').map(t=>t.id),['b']);
 assert.deepEqual(filterPersonalTasks(v.all,'handle','odd_end').map(t=>t.id),['a']);
 assert.equal(isForToday(task('invalid',{due_date:'bad',focus_date:''}),today),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMessagesView,backgroundMessageIssue} from '../src/lib/messagesWorkspace.js';

const now=Date.parse('2026-09-13T04:00:00Z');
const fresh={enabled:true,last_seen_at:new Date(now-60000).toISOString(),source_ok:true};
const issue=input=>backgroundMessageIssue({now,...input});

test('BlueBubbles opens by default; explicit workspace links still work',()=>{
 assert.equal(resolveMessagesView(new URLSearchParams()),'bluebubbles');
 for(const view of ['bluebubbles','inbox','assistant']) assert.equal(resolveMessagesView(new URLSearchParams({view})),view);
 assert.equal(resolveMessagesView(new URLSearchParams({view:'unknown'})),'bluebubbles');
});
test('existing job, contact and source-conversation links retain the review inbox',()=>{
 for(const key of ['conversation','job','contact']) {
  assert.equal(resolveMessagesView(new URLSearchParams({[key]:'example'})),'inbox');
  assert.equal(resolveMessagesView(new URLSearchParams({[key]:'example',view:'unknown'})),'inbox');
  assert.equal(resolveMessagesView(new URLSearchParams({[key]:'example',view:'assistant'})),'assistant');
 }
});
test('healthy connections and deliberately paused collectors stay quiet',()=>{
 assert.equal(issue({bridgeDevices:[fresh],assistantDevices:[fresh,{enabled:false,last_seen_at:'invalid',last_error:'old failure'}]}),null);
 assert.equal(issue({bridgeDevices:[{...fresh,enabled:false,source_ok:false,last_error:'paused'}]}),null);
});
test('stalled, failed and unavailable enabled sources lead to the appropriate tool',()=>{
 assert.equal(issue({bridgeDevices:[{...fresh,last_seen_at:new Date(now-600001).toISOString()}]}).view,'inbox');
 assert.equal(issue({bridgeDevices:[{...fresh,source_ok:false}]}).view,'inbox');
 assert.equal(issue({assistantDevices:[{...fresh,last_error:'failure'}]}).view,'assistant');
 assert.equal(issue({assistantDevices:[{enabled:true}]}).view,'assistant');
 assert.equal(issue({assistantDevices:[{...fresh,last_seen_at:new Date(now-600000).toISOString()}]}),null);
});
test('only unresolved cases needing information draw attention',()=>{
 assert.equal(issue({cases:[{status:'draft_review',result:{missing_info:['Which job?']}}]}).view,'assistant');
 assert.equal(issue({cases:[{status:'draft_review',result:{missing_info:[]}}]}),null);
 assert.equal(issue({cases:['completed','dismissed'].map(status=>({status,result:{missing_info:['Old issue']}}))}),null);
});
test('status fetch errors remain visible instead of silently hiding an outage',()=>{
 assert.equal(issue({bridgeError:'unavailable'}).view,'inbox');
 assert.equal(issue({assistantError:'unavailable'}).view,'assistant');
});

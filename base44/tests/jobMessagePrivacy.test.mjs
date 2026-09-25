import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationJobMatch,conversationsForJob} from '../shared/jobContacts.js';

const contact=(key,phone,job_ids)=>({key,phone_key:phone,job_ids});
const conversation=(key,participants,job_id='')=>({conversation_key:key,participants,job_id});

test('a group is never inferred from one job-linked contact',()=>{
 const contacts=[contact('customer','+13855550101',['job-a'])];
 const group=conversation('group-collision',['+13855550101','+13855550999']);
 assert.deepEqual(conversationJobMatch(group,'job-a',contacts),{matched:false,basis:'group_requires_explicit_link'});
 assert.deepEqual(conversationsForJob([group],'job-a',contacts),[]);
});

test('multiple groups and possible jobs all fail closed without explicit association',()=>{
 const contacts=[contact('shared','+13855550101',['job-a','job-b']),contact('other','+13855550202',['job-b'])];
 const rows=[
  conversation('group-a',['+13855550101','+13855550999']),
  conversation('group-b',['+13855550202','+13855550888']),
  conversation('ambiguous-direct',['+13855550101'])
 ];
 assert.deepEqual(conversationsForJob(rows,'job-a',contacts),[]);
 assert.equal(conversationJobMatch(rows[2],'job-a',contacts).basis,'ambiguous_contact_jobs');
 assert.deepEqual(conversationsForJob(rows,'job-b',contacts),[]);
});

test('an explicit association includes the exact group only for its job',()=>{
 const linked=conversation('linked-group',['+13855550101','+13855550999'],'job-a');
 assert.deepEqual(conversationJobMatch(linked,'job-a',[]),{matched:true,basis:'explicit'});
 assert.deepEqual(conversationJobMatch(linked,'job-b',[]),{matched:false,basis:'explicit_other_job'});
});

test('a non-group direct message keeps unambiguous verified contact behavior',()=>{
 const contacts=[contact('customer','+13855550101',['job-a'])];
 const direct=conversation('direct',['(385) 555-0101']);
 assert.deepEqual(conversationJobMatch(direct,'job-a',contacts),{matched:true,basis:'verified_direct_contact'});
 assert.deepEqual(conversationsForJob([direct],'job-a',contacts),[direct]);
 assert.deepEqual(conversationsForJob([direct],'job-b',contacts),[]);
});

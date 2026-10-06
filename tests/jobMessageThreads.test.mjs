import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveJobMessageThreads} from '../base44/shared/jobMessageThreads.js';

const convo=(key,participants,job_id='')=>({conversation_key:key,participants,job_id});
const contact=(key,phone)=>({key,phone_key:phone});

test('includes only exact job links or one confirmed contact-job association',()=>{
 const result=resolveJobMessageThreads({jobId:'job-1',conversations:[convo('exact',[],'job-1'),convo('confirmed',['8015550101']),convo('unconfirmed',['8015550102'])],contacts:[contact('c1','8015550101'),contact('c2','8015550102')],links:[{contact_key:'c1',job_id:'job-1'}]});
 assert.deepEqual(result.threads.map(t=>[t.conversation.conversation_key,t.provenance.type]),[['exact','exact_job'],['confirmed','confirmed_contact']]);
});

test('shared phone numbers and contacts linked to multiple jobs remain review-only',()=>{
 const result=resolveJobMessageThreads({jobId:'job-1',conversations:[convo('shared',['8015550101']),convo('multiple-jobs',['8015550102']),convo('contractor',['8015550103'])],contacts:[contact('a','8015550101'),contact('b','8015550101'),contact('c','8015550102'),contact('contractor','8015550103')],links:[{contact_key:'a',job_id:'job-1'},{contact_key:'c',job_id:'job-1'},{contact_key:'c',job_id:'job-2'}]});
 assert.equal(result.threads.length,0);
 assert.deepEqual(result.review.map(r=>r.conversation_key),['shared','multiple-jobs','contractor']);
});

test('unlinked group and unverified participants never infer from one matching contact',()=>{
 const conversations=[convo('known-unknown',['8015550101','8015559999']),convo('two-known',['8015550101','8015550102']),convo('duplicate',['8015550101','8015550101']),convo('invalid',['8015550101','']),convo('empty',[])];
 const result=resolveJobMessageThreads({jobId:'job-1',conversations,contacts:[contact('c1','8015550101'),contact('c2','8015550102')],links:[{contact_key:'c1',job_id:'job-1'},{contact_key:'c2',job_id:'job-1'}]});
 assert.deepEqual(result.threads,[]);
 assert.equal(result.review.length,5);
});
test('explicit group remains allowed, link to another job is never inferred, direct match still works',()=>{
 const result=resolveJobMessageThreads({jobId:'job-1',conversations:[convo('explicit',['8015550101','8015559999'],'job-1'),convo('other',['8015550101'],'job-2'),convo('direct',['8015550101'])],contacts:[contact('c1','8015550101')],links:[{contact_key:'c1',job_id:'job-1'}]});
 assert.deepEqual(result.threads.map(t=>t.conversation.conversation_key),['explicit','direct']);
});

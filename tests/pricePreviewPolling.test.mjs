import test from 'node:test';
import assert from 'node:assert/strict';
import {watchPricePreview} from '../src/components/window-quotes/pricePreviewPolling.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function timers(){let time=0;const queue=[];return {queue,options:{now:()=>time,setTimer:(fn,ms)=>{const item={fn,ms};queue.push(item);return item;},clearTimer:item=>{if(item)item.cancelled=true;}},async next(){const item=queue.shift();if(!item)return false;time+=item.ms;if(!item.cancelled)await item.fn();return true;}};}
test('a response for an old size never replaces the price for the current size',async()=>{
 const t=timers(),old=deferred(),seen=[];
 const cancel=watchPricePreview(()=>old.promise,x=>seen.push(x),t.options);
 const pending=t.next();cancel();
 watchPricePreview(async()=>({pending:false,lines:[{status:'priced',unit_prices:{customer:200}}]}),x=>seen.push(x),t.options);
 await t.next();old.resolve({pending:false,lines:[{status:'priced',unit_prices:{customer:999}}]});await pending;
 assert.equal(seen.at(-1).lines[0].unit_prices.customer,200);assert(!seen.some(x=>x.lines?.[0]?.unit_prices?.customer===999));
});
test('pending native work is polled until its verified price arrives, then stops',async()=>{
 const t=timers(),seen=[];let calls=0;
 watchPricePreview(async()=>++calls===1?{pending:true,retry_after_ms:2000,lines:[{status:'calculating'}]}:{pending:false,lines:[{status:'priced',unit_prices:{customer:300}}]},x=>seen.push(x),t.options);
 await t.next();await t.next();assert.equal(calls,2);assert.equal(seen.at(-1).lines[0].unit_prices.customer,300);assert.equal(t.queue.length,0);
});
test('cancelling before debounce sends nothing and repeated network errors end without a stale price',async()=>{
 const t=timers();let calls=0;const seen=[];
 const cancel=watchPricePreview(async()=>{calls++;throw Error();},x=>seen.push(x),t.options);cancel();await t.next();assert.equal(calls,0);
 watchPricePreview(async()=>{calls++;throw Error();},x=>seen.push(x),t.options);await t.next();await t.next();await t.next();assert.equal(calls,3);assert.equal(seen.at(-1).status,'unavailable');assert.equal(t.queue.length,0);
});


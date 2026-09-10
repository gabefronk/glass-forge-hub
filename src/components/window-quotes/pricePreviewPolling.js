// Cancelling an edit invalidates both its timer and any response already in flight.
export function watchPricePreview(load, publish, {debounceMs=650,retryMs=2000,maxMs=120000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
 let cancelled=false,timer,failures=0;
 const deadline=now()+maxMs;
 publish({status:'loading',lines:[],total:null,ready:false});
 const schedule=delay=>{timer=setTimer(run,delay);};
 async function run(){
  if(cancelled)return;
  try{
   const result=await load();if(cancelled)return;failures=0;
   publish({...result,status:'ready'});
   if(result.pending===true&&now()<deadline)schedule(Math.min(5000,Math.max(retryMs,Number(result.retry_after_ms)||retryMs)));
  }catch{
   if(cancelled)return;
   if(++failures<3&&now()<deadline)schedule(retryMs*failures);
   else publish({status:'unavailable',lines:[],total:null,ready:false});
  }
 }
 schedule(debounceMs);
 return ()=>{cancelled=true;clearTimer(timer);};
}


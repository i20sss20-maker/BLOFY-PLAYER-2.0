// Only coalesce identical, account-scoped catalog reads. No media or
// subscription decisions are shared. One disconnected waiter cannot cancel others.
export function createCatalogFlights({maxFlights=12,maxWaiters=8,timeoutMs=25000}={}){
 const flights=new Map();let joined=0,rejected=0,started=0;
 function run(key,loader,signal){
  if(signal?.aborted)return Promise.resolve({status:499,error:'catalog_cancelled'});
  let flight=flights.get(key);
  if(flight&&flight.waiters.size>=maxWaiters||!flight&&flights.size>=maxFlights){rejected++;return Promise.resolve({status:429,error:'catalog_busy'})}
  if(!flight){
   const controller=new AbortController();
   flight={controller,waiters:new Set(),timer:null};flights.set(key,flight);started++;
   const f=flight;
   function finish(result){
    if(flights.get(key)===f)flights.delete(key);
    clearTimeout(f.timer);
    for(const waiter of [...f.waiters])waiter.finish(result);
   }
   f.timer=setTimeout(()=>{controller.abort();finish({status:504,error:'catalog_timeout'})},timeoutMs);
   Promise.resolve().then(()=>loader(controller.signal)).then(finish,()=>finish({status:502,error:'catalog_page_failed'}));
  }else joined++;
  const f=flight;
  return new Promise(resolve=>{
   const waiter={finish(result){f.waiters.delete(waiter);signal?.removeEventListener('abort',abort);resolve(result)}};
   function abort(){
    waiter.finish({status:499,error:'catalog_cancelled'});
    if(!f.waiters.size&&flights.get(key)===f){flights.delete(key);clearTimeout(f.timer);f.controller.abort()}
   }
   f.waiters.add(waiter);signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
  })
 }
 return {run,snapshot(){return {active:flights.size,joined,rejected,started}}}
}

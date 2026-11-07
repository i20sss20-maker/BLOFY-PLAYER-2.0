// Bound concurrent catalog imports so large provider streams don't exhaust
// the small PostgreSQL pool or trigger bursts of simultaneous upstream requests.
// A scheduled import is not a successful sync; errors are delivered to onError.
// Queue is process-local, deliberately not a distributed job system.
export function createXtreamSyncQueue({concurrency=1,maxPending=16,onError=()=>{}}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2||
      !Number.isInteger(maxPending)||maxPending<1||maxPending>100||
      typeof onError!=='function')throw new Error('xtream_sync_queue_configuration_invalid');
  const waiting=[];
  const active=new Set();
  const scheduled=new Set();
  let closed=false;

  function drain(){
    while(!closed&&active.size<concurrency&&waiting.length){
      const job=waiting.shift();
      active.add(job.id);
      // Defer execution until after all synchronous enqueue operations complete.
      void Promise.resolve().then(job.run).catch(error=>{
        try{onError(job.id,error)}catch{}
      }).finally(()=>{
        active.delete(job.id);
        scheduled.delete(job.id);
        drain();
      });
    }
  }

  function enqueue(id,run){
    if(closed)throw new Error('xtream_sync_queue_closed');
    if(typeof id!=='string'||!id||typeof run!=='function')
      throw new Error('xtream_sync_queue_task_invalid');
    if(scheduled.has(id))throw new Error('xtream_sync_in_progress');
    if(waiting.length>=maxPending)throw new Error('xtream_sync_queue_full');
    const queued=active.size>=concurrency;
    scheduled.add(id);
    waiting.push({id,run});
    drain();
    return {queued,position:queued?waiting.length:0};
  }

  function cancel(id){
    const index=waiting.findIndex(item=>item.id===id);
    if(index<0)return false;
    waiting.splice(index,1);
    scheduled.delete(id);
    return true;
  }

  function close(){
    closed=true;
    for(const job of waiting)scheduled.delete(job.id);
    waiting.length=0;
  }

  return Object.freeze({
    enqueue,cancel,close,
    has:id=>scheduled.has(id),
    isQueued:id=>waiting.some(item=>item.id===id),
    activeCount:()=>active.size,
    waitingCount:()=>waiting.length
  });
}

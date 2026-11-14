// Operator-started, intentionally non-public licensed film copy loop.
// A batch is at most one 8MiB source read. Each batch has a durable
// PostgreSQL/S3 checkpoint. No automatic startup or subscriber cutover.
export function createContinuousCopyController({
 runBatch,readiness,logger=()=>{},delayMs=1500,
 maxBatches=400,maxDurationMs=40*60*1000,
 pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
 if(typeof runBatch!=='function'||typeof readiness!=='function')
  throw Error('content_hub_copy_controller_dependency_missing');
 if(!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>400||
    !Number.isSafeInteger(delayMs)||delayMs<0||delayMs>10000||
    !Number.isSafeInteger(maxDurationMs)||maxDurationMs<1000)
  throw Error('content_hub_copy_controller_limits_invalid');
 let controller=null;
 let status={state:'idle',batchesThisRun:0,code:null,
   bytesCopied:null,startedAt:null,finishedAt:null,customerCutover:false};
 const snapshot=()=>({...status,active:controller!==null});
 function stop(){
  if(!controller)return {...snapshot(),ok:false,code:'copy_not_running'};
  controller.abort();
  status={...status,state:'stopping',code:'copy_stop_requested'};
  return {...snapshot(),ok:true,code:'copy_stop_requested'};
 }
 function start(){
  if(controller)return {...snapshot(),ok:false,code:'copy_already_running'};
  const ready=readiness();
  if(!ready?.ready)return {...snapshot(),ok:false,
    code:'copy_safety_gates_off',blockedBy:ready?.blockedBy||[]};
  const abort=new AbortController();
  controller=abort;
  const began=Date.now();
  status={state:'running',code:'copy_started',batchesThisRun:0,
    bytesCopied:status.bytesCopied,startedAt:new Date().toISOString(),
    finishedAt:null,customerCutover:false};
  void (async()=>{
   for(let n=0;n<maxBatches;n++){
    if(abort.signal.aborted){status={...status,state:'paused',
      code:'copy_stopped_by_operator'};break}
    if(Date.now()-began>=maxDurationMs){status={...status,
      state:'paused',code:'copy_session_time_limit'};break}
    const again=readiness();
    if(!again?.ready){status={...status,state:'paused',
      code:'copy_safety_gates_changed'};break}
    let result;
    try{result=await runBatch({signal:abort.signal})}
    catch{result={ok:false,code:'copy_batch_exception'}}
    if(['batch_checkpoint_saved','episode_checkpoint_saved'].includes(result?.code)&&result.ok){
     status={...status,state:'running',code:result.code,
      batchesThisRun:status.batchesThisRun+1,
      bytesCopied:Number(result.bytesCopied||0)};
    }else if(result?.ok&&
       (result.completed===true||result.code==='batch_already_verified'||
        result.code==='episode_already_verified')){
     status={...status,state:'completed',code:result.code,
      batchesThisRun:status.batchesThisRun+1,
      bytesCopied:Number(result.bytes||result.bytesCopied||0)};
     break;
    }else{
     status={...status,state:abort.signal.aborted?'paused':'failed',
      code:abort.signal.aborted?'copy_stopped_by_operator':
       String(result?.code||'copy_batch_failed').slice(0,80),
      errorStage:String(result?.errorStage||'').slice(0,40)||null};
     break;
    }
    if(n===maxBatches-1){status={...status,
      state:'paused',code:'copy_batch_session_limit'};break}
    // No automatic retry on failures. Delay prevents upstream burst load.
    if(delayMs>0)await pause(delayMs);
   }
  })().catch(()=>{
   status={...status,state:'failed',code:'copy_controller_failed'};
  }).finally(()=>{
   if(abort.signal.aborted&&status.state==='running')
    status={...status,state:'paused',code:'copy_stopped_by_operator'};
   status={...status,finishedAt:new Date().toISOString()};
   if(controller===abort)controller=null;
   logger('BLOFY_CONTENT_HUB_CONTINUOUS_COPY',snapshot());
  });
  return {...snapshot(),ok:true,code:'copy_started'};
 }
 return {start,stop,status:snapshot,isRunning:()=>controller!==null};
}

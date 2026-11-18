/**
 * Graceful HTTP drain for Railway deployment replacement.
 *
 * Keep in-flight Range/APK downloads open after SIGTERM while refusing new
 * connections. This is best-effort, never a guarantee that large downloads
 * finish: the platform can still kill the container at its hard deadline.
 * Download clients must retain their existing byte-range resume behavior.
 */
export function installGracefulShutdown({
  server,
  emitter=process,
  stopJobs=()=>{},
  closeResources=async()=>{},
  terminate=code=>process.exit(code),
  logger=console,
  drainMs=105_000
}={}){
  if(!server || typeof server.close!=='function' ||
     !emitter || typeof emitter.on!=='function' ||
     typeof stopJobs!=='function' ||
     typeof closeResources!=='function' ||
     typeof terminate!=='function' ||
     !Number.isSafeInteger(drainMs)||drainMs<1||drainMs>115_000)
    throw new Error('invalid_graceful_shutdown_configuration');

  let draining=false,finished=false,timer=null;
  let resourceCloseStarted=false;

  async function finish(code){
    if(finished)return;
    finished=true;
    if(timer){clearTimeout(timer);timer=null;}
    // Closing shared Postgres pools only AFTER all HTTP requests finish
    // preserves safe download-completion metrics and concurrent admin ops.
    try{
      if(!resourceCloseStarted){
        resourceCloseStarted=true;
        await closeResources();
      }
    }catch(error){
      logger.error?.('BLOFY shutdown resources failed:',error?.message||error);
      code=1;
    }
    terminate(code);
  }

  function begin(signal){
    if(draining)return false;
    draining=true;
    logger.info?.(`BLOFY shutdown requested: ${signal}; draining active HTTP requests`);
    try{stopJobs();}catch(error){
      logger.error?.('BLOFY background shutdown failed:',error?.message||error);
    }
    timer=setTimeout(()=>{
      if(finished)return;
      logger.warn?.('BLOFY HTTP drain deadline reached; closing remaining connections');
      try{server.closeAllConnections?.();}catch(error){
        logger.error?.('BLOFY force-close failed:',error?.message||error);
      }
      void finish(1);
    },drainMs);
    timer.unref?.();
    // Node >=19 drains idle keep-alive sockets with close(). Active APK
    // responses are allowed to finish until the configured deadline.
    try{
      server.close(error=>{
        if(error&&error.code!=='ERR_SERVER_NOT_RUNNING'){
          logger.error?.('BLOFY HTTP close failed:',error?.message||error);
          void finish(1);
        }else void finish(0);
      });
      server.closeIdleConnections?.();
    }catch(error){
      logger.error?.('BLOFY HTTP server.close failed:',error?.message||error);
      void finish(1);
    }
    return true;
  }

  const term=()=>begin('SIGTERM'),interrupt=()=>begin('SIGINT');
  emitter.on('SIGTERM',term);
  emitter.on('SIGINT',interrupt);
  return {
    isDraining:()=>draining,
    // For tests / orderly teardown. Do not remove while running.
    unregister:()=>{
      emitter.off?.('SIGTERM',term);
      emitter.off?.('SIGINT',interrupt);
    }
  };
}

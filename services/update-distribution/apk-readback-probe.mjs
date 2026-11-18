import {open} from 'node:fs/promises';
import path from 'node:path';
import {pinnedSignedApks,makeS3MirrorStore,mirrorConfigFromEnv} from './signed-apk-mirror.mjs';

// Owner-only small-range integrity canary. No public URL and no customer
// traffic is switched to S3. Byte-for-byte comparison must be proven
// before discussing origin/cdn cutover. Requests are singleflight and capped.
export function createApkMirrorReadiness({
  config=mirrorConfigFromEnv(),
  localDir='/data/releases',
  storeFactory=makeS3MirrorStore,
  openFile=open,
  now=()=>Date.now(),
  cooldownMs=60_000,
  sampleSize=4096
}={}){
  if(!Number.isSafeInteger(cooldownMs)||cooldownMs<1000||
    !Number.isSafeInteger(sampleSize)||sampleSize<16||sampleSize>8192)
    throw Error('mirror_probe_configuration_invalid');
  let inFlight=null,lastCheckedAt=0,lastResult=null;
  const names=pinnedSignedApks();
  function status(){
    return lastResult||{ok:false,code:'not_tested',mode:'read_only',
      customerTrafficChanged:false,checkedAt:null};
  }
  async function probe(){
    if(!config.enabled||!config.ready)return {
      ok:false,code:'backup_unconfigured',mode:'read_only',
      customerTrafficChanged:false};
    if(inFlight)return inFlight;
    if(lastCheckedAt&&now()-lastCheckedAt<cooldownMs)
      return {...status(),rateLimited:true};
    const job=(async()=>{
      const results=[];
      let store;
      try{
        store=await storeFactory(config);
        for(const pin of names){
          const version=pin.filename.includes('56.0-')?'56.0':'55.8.36';
          let file;
          try{
            const key='signed-apk/sha256/'+pin.sha256+'.apk';
            const head=await store.head(key);
            if(!head||Number(head.ContentLength)!==pin.size||
              head.Metadata?.sha256!==pin.sha256){
              results.push({version,ok:false,code:'object_metadata_mismatch'});
              continue;
            }
            file=await openFile(path.join(localDir,pin.filename),'r');
            const spans=[{start:0,end:Math.min(sampleSize,pin.size)-1},
              {start:Math.max(0,pin.size-sampleSize),end:pin.size-1}];
            let passed=true;
            for(const span of spans){
              const size=span.end-span.start+1;
              const local=Buffer.alloc(size);
              const read=await file.read(local,0,size,span.start);
              if(read.bytesRead!==size){passed=false;break;}
              const remote=await store.readRange(key,span.start,span.end);
              if(!Buffer.isBuffer(remote)||remote.length!==size||
                 !remote.equals(local)){passed=false;break;}
            }
            results.push({version,ok:passed,
              code:passed?'head_and_byte_ranges_match':'byte_range_mismatch'});
          }catch{
            results.push({version,ok:false,code:'probe_read_failed'});
          }finally{try{await file?.close();}catch{}}
        }
      }catch{
        for(const pin of names)results.push({
          version:pin.filename.includes('56.0-')?'56.0':'55.8.36',
          ok:false,code:'private_storage_unavailable'});
      }finally{try{store?.close?.();}catch{}}
      const ok=results.length===names.length&&results.every(x=>x.ok);
      lastResult={ok,code:ok?'verified_readback':'readback_failed',
        mode:'read_only',customerTrafficChanged:false,
        checkedAt:new Date(now()).toISOString(),sampleBytes:sampleSize,
        results};
      lastCheckedAt=now();
      return lastResult;
    })();
    inFlight=job;
    try{return await job;}
    finally{if(inFlight===job)inFlight=null;}
  }
  return {probe,status};
}

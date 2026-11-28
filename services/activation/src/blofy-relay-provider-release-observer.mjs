// Private adapter for the real authenticated provider ACCOUNT read, not a
// media probe. Never turn a cached account snapshot or local idle count into
// release proof. The separately trusted all-path coverage check is mandatory.
const owner=x=>x==='hostbrr'||x==='linode';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createRelayProviderReleaseObserver({sourceId,expectedRelayMaxConnections,
 readApprovedSource,readOwnerState,readProviderAccount,verifyCoverage,clock=Date.now}={}){
 const quota=expectedRelayMaxConnections;
 return async function observe(identity){
  if(!uuid.test(sourceId??'')||identity?.sourceId!==sourceId||
     ![null,'hostbrr','linode'].includes(identity.previousOwner)||
     !owner(identity.nextOwner)||identity.previousOwner===identity.nextOwner||
     !Number.isSafeInteger(identity.drainStartedAt)||
     !Number.isSafeInteger(quota)||quota<1||
     [readApprovedSource,readOwnerState,readProviderAccount,verifyCoverage].some(x=>typeof x!=='function'))return null;
  const expected=Object.freeze({sourceId,previousOwner:identity.previousOwner,nextOwner:identity.nextOwner,drainStartedAt:identity.drainStartedAt});
  const matches=s=>s?.ok===true&&s.mode==='draining'&&s.owner===expected.previousOwner&&
   s.nextOwner===expected.nextOwner&&s.epoch===expected.drainStartedAt&&s.openHolds===0;
  const approved=s=>s?.sourceId===sourceId&&s.reportedMaxConnections===quota;
  try{
   if(!approved(await readApprovedSource())||!matches(await readOwnerState())||
      await verifyCoverage({...expected,phase:'drained'})!==true)return null;
   const started=clock();
   if(started<expected.drainStartedAt)return null;
   // Production reader: readEngineProviderAccount(sourceId), bounded account
   // GET with no action, no media open and no metadata writes.
   const counts=await readProviderAccount(sourceId);
   const observedAt=clock();
   if(counts?.activeConnections!==0||counts?.maxConnections!==quota||
      observedAt<started||observedAt-started>7000)return null;
   if(!matches(await readOwnerState())||!approved(await readApprovedSource())||
      await verifyCoverage({...expected,phase:'drained'})!==true)return null;
   const now=clock();
   if(now<observedAt||now-observedAt>3000)return null;
   return {sourceId,previousOwner:expected.previousOwner,drainStartedAt:expected.drainStartedAt,
    activeConnections:0,maxConnections:quota,observedAt,authoritative:true,scope:'all_paths'};
  }catch{return null}
 };
}

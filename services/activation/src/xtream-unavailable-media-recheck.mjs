// Bounded and idempotent lease-based recovery runner.
// Fetches only previously observed upstream 404 items. The caller supplies
// a same-source, same-item authorized first-byte probe. No fallback IDs,
// customer permission changes or full-length video downloads.
import {
 claimDueMedia,finishUnavailableRecheck,validUnavailableKey
} from './xtream-unavailable-media-registry.mjs';

export async function runUnavailableRecheckBatch({
 pool,sourceId,probe,limit=3
}={}){
 const checked={checked:0,recovered:0,stillMissing:0,transient:0,
   videoDecoded:false,subscriberCutover:false,catalogMutation:false};
 if(!pool||typeof probe!=='function')return checked;
 const leased=await claimDueMedia(pool,sourceId,{limit});
 for(const row of leased){
  const key=validUnavailableKey({serverId:row.server_id,kind:row.kind,
   itemId:row.item_id,seriesId:row.series_id});
  if(!key)continue;
  checked.checked++;
  let result='transient';
  try{
   const answer=await probe(key);
   if(['recovered','provider404'].includes(answer))result=answer;
  }catch{
   // Retry a connection failure later, never turn it into a missing file.
  }
  await finishUnavailableRecheck(pool,key,{
   result,rechecks:Number(row.recheck_count)||0
  });
  if(result==='recovered')checked.recovered++;
  else if(result==='provider404')checked.stillMissing++;
  else checked.transient++;
 }
 return checked;
}

export function classifyUnavailableProbe({status=null,relayFailure=null,firstChunkValid=false}={}){
 if((status===200||status===206)&&firstChunkValid)return 'recovered';
 if(status===502&&relayFailure==='relay_provider_not_found')
  return 'provider404';
 return 'transient';
}

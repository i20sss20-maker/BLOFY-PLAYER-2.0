import {setTimeout as sleep} from 'node:timers/promises';
// Only an explicit, authenticated pinned relay refusal BEFORE media delivery
// permits one retry of the identical opaque ticket. Never switch engines or
// retry provider denial, quota rejection, cooldown, or ambiguous transport.
export function sharedLiveHandoffDelay({status,reason,retryAfter,attempt=0,random=Math.random}={}){
 if(attempt!==0||status!==503||reason!=='fanout_source_handoff_pending'||
    !Number.isInteger(retryAfter)||retryAfter<1||retryAfter>2)return null;
 const n=Number(random());return retryAfter*1000+Math.round((Number.isFinite(n)?Math.max(0,Math.min(1,n)):0.5)*150);
}
export async function waitSharedLiveHandoff({signal,...args}={}){
 const ms=sharedLiveHandoffDelay(args);
 if(ms===null||signal?.aborted)return false;
 try{await sleep(ms,undefined,{signal});return !signal?.aborted}catch{return false}
}

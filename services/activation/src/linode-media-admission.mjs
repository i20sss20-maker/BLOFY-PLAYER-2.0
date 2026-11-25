import {preflightLinodeLive} from './linode-media-canary-preflight.mjs';
// Routing decision only. The capacity owner must serialize admission with ALL
// legacy and new paths or prove that this is a separately licensed test pool.
// Never use a local counter or a health report as an upstream reservation.
// A timeout is ambiguous: it must not open a second upstream connection.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId=x=>typeof x==='string'&&UUID.test(x);
const timestamp=x=>typeof x==='string'?Date.parse(x):NaN;
const blocked=reason=>({action:'hold',reason,retryAfterSeconds:5});
const legacy=reason=>({action:'legacy',reason});
export function decideLinodeAdmission({context,requestId,capacity,attempt}={},env=process.env,now=Date.now()){
  // Caller must supply the persisted attempt, not a default "not started",
  // for retries. The request ID is generated and stored by the control plane.
  if(!validId(requestId)||!attempt||attempt.requestId!==requestId||
    !['not_started','pending','denied','reserved','released','unknown'].includes(attempt.state))
    return blocked('attempt_unknown');
  const pre=preflightLinodeLive(context,env,now);
  if(attempt.state==='pending'||attempt.state==='unknown')
    return blocked('reservation_outcome_unknown');
  if(attempt.state==='released'||attempt.state==='denied'){
    // Only authoritative confirmation that this attempt never opened a feed,
    // or that its resources are released, can permit legacy routing again.
    if(attempt.authoritative!==true||attempt.noNewFeed!==true)
      return blocked('release_not_confirmed');
    return legacy('reservation_closed');
  }
  if(attempt.state==='not_started'&&!pre.eligible)return legacy(pre.reason);
  if(!pre.eligible)return blocked('release_required');
  // For now no capacity authority exists on Linode. This contract explicitly
  // rejects uncoordinated counters and requires fresh, source-scoped proof.
  const observed=timestamp(capacity?.observedAt);
  const authoritative=capacity?.authoritative===true&&
    ['all_paths','dedicated_licensed_pool'].includes(capacity?.scope)&&
    capacity.sourceId===pre.sourceId&&capacity.providerQuota===pre.providerQuota&&
    Number.isFinite(observed)&&observed>=now-15000&&observed<=now+5000;
  if(!authoritative)
    return attempt.state==='not_started'?legacy('capacity_authority_unavailable'):blocked('capacity_authority_unavailable');
  if(attempt.state==='not_started')
    return {action:'reserve',requestId,accountId:pre.accountId,sourceId:pre.sourceId,
      channelId:pre.channelId,providerQuota:pre.providerQuota,accountQuota:pre.accountQuota,
      expiresAt:pre.expiresAt};
  const until=timestamp(attempt.expiresAt);
  if(attempt.authoritative!==true||attempt.committed!==true||!validId(attempt.reservationId)||
    attempt.accountId!==pre.accountId||attempt.sourceId!==pre.sourceId||
    attempt.channelId!==pre.channelId||!Number.isFinite(until)||until<=now)
    return blocked('reservation_invalid');
  return {action:'linode',requestId,reservationId:attempt.reservationId,
    expiresAt:new Date(Math.min(until,Date.parse(pre.expiresAt))).toISOString()};
}

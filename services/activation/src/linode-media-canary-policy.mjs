// Isolated rollout policy. No network calls, account writes or production routing.
// Inputs MUST be obtained from trusted server-side authorization and capacity
// reservation, never from the request body or client-provided feature flags.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL=/^[0-9]{1,20}$/;
export function evaluateLinodeMediaCanary(context,env=process.env,now=Date.now()){
  const deny=reason=>({allowed:false,reason,route:'legacy'});
  if(env.BLOFY_LINODE_MEDIA_CANARY!=='1')return deny('disabled');
  if(!context||!Number.isFinite(now))return deny('invalid_context');
  const {account,source,channel,engine,reservation}=context;
  const id=env.BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID;
  if(!UUID.test(id||'')||!UUID.test(account?.id||'')||
      account.id.toLowerCase()!==id.toLowerCase()||
      account.authenticated!==true||account.enabled!==true)
    return deny('account_not_allowed');
  const expires=Date.parse(account.expiresAt);
  if(!Number.isFinite(expires)||expires<=now)return deny('account_expired');
  if(!UUID.test(source?.id||'')||account.sourceId!==source.id||
      source.enabled!==true||source.restreamAuthorized!==true||
      source.distributionRightsVerified!==true)
    return deny('source_not_authorized');
  if(!CHANNEL.test(channel?.id||'')||channel.sourceId!==source.id||
      channel.kind!=='live'||channel.entitled!==true)
    return deny('channel_not_entitled');
  const observed=Date.parse(engine?.observedAt);
  if(engine?.healthy!==true||engine?.customerTrafficEnabled!==false||
      engine?.realSourceVerified!==true||!Number.isFinite(observed)||
      observed>now+5000||observed<now-90000)
    return deny('engine_not_verified');
  // This is a gate, not a capacity allocator. A reservation must be made
  // atomically by the authoritative source/session manager before routing.
  const until=Date.parse(reservation?.expiresAt);
  if(!UUID.test(reservation?.id||'')||reservation?.committed!==true||
      reservation.sourceId!==source.id||reservation.channelId!==channel.id||
      reservation.accountId!==account.id||
      !Number.isFinite(until)||until<=now)
    return deny('capacity_not_reserved');
  return {allowed:true,reason:'eligible',route:'linode-canary',
    expiresAt:new Date(Math.min(expires,until,now+60000)).toISOString()};
}

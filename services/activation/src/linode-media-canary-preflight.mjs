// Adapter for already authenticated account and catalog rows from proxyMedia.
// This is not an endpoint; never pass client JSON as evidence. No credentials
// or provider URLs are returned. Preflight does not reserve or open a feed.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=v=>typeof v==='string'&&UUID.test(v)?v.toLowerCase():null;
const streamId=v=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v)?v:null;
const expiry=v=>typeof v==='string'||v instanceof Date?new Date(v).getTime():NaN;
export function preflightLinodeLive({account,row,kind,method,distributorAllowed,rights,engine}={},env=process.env,now=Date.now()){
  const deny=reason=>({eligible:false,reason});
  if(env.BLOFY_LINODE_MEDIA_CANARY!=='1')return deny('disabled');
  if(!Number.isFinite(now)||kind!=='live'||method!=='GET')return deny('unsupported_request');
  const accountId=id(account?.id),sourceId=id(row?.server_id),channelId=streamId(row?.source_id);
  if(!accountId||accountId!==id(env.BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID)||
     account?.enabled!==true||!Number.isSafeInteger(account.max_connections)||account.max_connections<1||
     !Number.isFinite(expiry(account.expires_at))||expiry(account.expires_at)<=now)
    return deny('account_not_eligible');
  if(!sourceId||sourceId!==id(account.source_id)||sourceId!==id(env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID)||
     row.server_enabled!==true||distributorAllowed!==true||
     !channelId||channelId!==streamId(env.BLOFY_LINODE_MEDIA_TEST_CHANNEL_ID))
    return deny('catalog_not_eligible');
  // Independent, documented grant for THIS source and new media host. The
  // old relay's manual approval or provider metadata alone is not evidence.
  if(rights?.verified!==true||id(rights.sourceId)!==sourceId||
     rights.mediaHost!=='media.blofyplayer.com'||
     !Number.isFinite(expiry(rights.expiresAt))||expiry(rights.expiresAt)<=now)
    return deny('rights_not_verified');
  const quota=row.source_reported_max_connections;
  if(!Number.isSafeInteger(quota)||quota<1||quota>64)return deny('quota_unknown');
  const checked=expiry(engine?.observedAt);
  if(engine?.healthy!==true||engine?.customerTrafficEnabled!==false||
     engine?.realSourceVerified!==true||id(engine.sourceId)!==sourceId||
     engine.channelId!==channelId||!Number.isFinite(checked)||checked<now-90000||checked>now+5000)
    return deny('source_playback_not_verified');
  return {eligible:true,reason:'reservation_required',accountId,sourceId,channelId,
    providerQuota:quota,accountQuota:account.max_connections,
    expiresAt:new Date(Math.min(expiry(account.expires_at),expiry(rights.expiresAt),now+60000)).toISOString()};
}

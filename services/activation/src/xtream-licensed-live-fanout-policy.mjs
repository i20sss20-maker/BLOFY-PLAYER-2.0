// Subscriber-authorized redistribution can reduce a channel to ONE source
// connection only when the actual provider grants rebroadcast rights.
// This does not bypass Xtream network access controls, connection limits or
// any upstream 403/456. A documented MANUAL provider grant may be used when
// the Xtream user_info restreamer flag is stale or not exposed. Default OFF.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function permittedLicensedLiveFanout({
 sourceId,sourceName,sourceNameMatches,kind,extension,upstreamRestreamer
}={},env=process.env){
 if(kind!=='live'||String(extension||'').toLowerCase()!=='ts'||
    !UUID.test(String(sourceId||'')))
  return false;
 // Operator-controlled, source-specific authorization; no account or global
 // all-sources shortcut. A signed provider grant must be checked outside code.
 if(env.BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED!=='1'||
    env.BLOFY_STREAM_SHARED_LIVE_CANARY!=='1')
  return false;
 const allowlist=new Set(String(env.BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS||'')
   .split(',').map(s=>s.trim().toLowerCase()).filter(s=>UUID.test(s)));
 // Explicit provider-restreamer accounts retain the existing scoped UUID
 // and unique-name allowlist. A manual provider grant NEVER broadens a UUID
 // allowlist: it is confined to one exact, unique source name.
 if(upstreamRestreamer===true&&allowlist.has(String(sourceId).toLowerCase()))
   return true;
 const configuredName=String(env.BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME||'')
   .trim().toLowerCase();
 const actualName=String(sourceName||'').trim().toLowerCase();
 const uniqueNamedSource=/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(configuredName)&&
   actualName===configuredName&&sourceNameMatches===1;
 if(!uniqueNamedSource)return false;
 // The provider's out-of-band consent is confirmed by the operator. The
 // flag is NOT a substitute for provider consent or a way around 403/456.
 const manualName=String(env.BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME||'')
   .trim().toLowerCase();
 const manualGrant=env.BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED==='1'&&
   manualName===actualName;
 return upstreamRestreamer===true||manualGrant;
}

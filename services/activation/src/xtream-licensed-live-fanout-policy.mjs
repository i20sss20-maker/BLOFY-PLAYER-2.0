// Subscriber-authorized redistribution can reduce a channel to ONE source
// connection only when the actual provider grants rebroadcast rights.
// This is NOT a way to override Xtream's max_connections or reuse a
// non-restreamer account against its access terms. Default OFF.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function permittedLicensedLiveFanout({
 sourceId,sourceName,sourceNameMatches,kind,extension,upstreamRestreamer
}={},env=process.env){
 if(kind!=='live'||String(extension||'').toLowerCase()!=='ts'||
    !UUID.test(String(sourceId||''))||upstreamRestreamer!==true)
  return false;
 // Operator-controlled, source-specific authorization; no account or global
 // all-sources shortcut. A signed provider grant must be checked outside code.
 if(env.BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED!=='1'||
    env.BLOFY_STREAM_SHARED_LIVE_CANARY!=='1')
  return false;
 const allowlist=new Set(String(env.BLOFY_XTREAM_SHARED_LIVE_SOURCE_IDS||'')
   .split(',').map(s=>s.trim().toLowerCase()).filter(s=>UUID.test(s)));
 if(allowlist.has(String(sourceId).toLowerCase()))return true;
 // The panel may give an operator the human-readable source name rather
 // than its UUID. Accept that exact name only when it resolves to exactly
 // ONE non-deleted upstream source, so duplicate names never widen rights.
 const configuredName=String(env.BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME||'')
   .trim().toLowerCase();
 const actualName=String(sourceName||'').trim().toLowerCase();
 return /^[a-z0-9][a-z0-9 _-]{0,63}$/.test(configuredName)&&
   actualName===configuredName&&sourceNameMatches===1;
}

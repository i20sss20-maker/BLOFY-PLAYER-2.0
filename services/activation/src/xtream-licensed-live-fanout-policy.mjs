// Subscriber-authorized redistribution can reduce a channel to ONE source
// connection only when the actual provider grants rebroadcast rights.
// This is NOT a way to override Xtream's max_connections or reuse a
// non-restreamer account against its access terms. Default OFF.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function permittedLicensedLiveFanout({
 sourceId,kind,extension,upstreamRestreamer
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
 return allowlist.has(String(sourceId).toLowerCase());
}

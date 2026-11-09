// Diagnostic recovery for one already-authenticated Xtream VOD item when
// the isolated STREAM relay reports a *verified* provider 404. The gateway may
// perform ONE same-file GET over its original egress to distinguish a
// region-dependent provider denial from a genuinely missing file.
// No different source, episode ID, extension, credentials or provider is tried.
// Disabled by default; source UUIDs explicitly allowlisted by the operator.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function shouldCompareRelay404Direct({
  sourceId,kind,method='GET',range,usingIndependentRelay=false,
  relayFailure='',alreadyTried=false
}={},env=process.env){
  if(method!=='GET'||alreadyTried||!usingIndependentRelay||
      relayFailure!=='relay_provider_not_found'||!['movie','series'].includes(kind))
    return false;
  const value=String(range||'').trim();
  if(value&&!/^bytes=0-(?:[0-9]{0,12})$/i.test(value))return false;
  const ids=String(env.BLOFY_XTREAM_RELAY_404_DIRECT_COMPARE_SOURCE_IDS||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x));
  return ids.includes(String(sourceId||'').toLowerCase());
}

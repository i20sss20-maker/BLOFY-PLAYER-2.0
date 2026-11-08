// Only a signed, source-scoped BLOFY STREAM relay ticket can carry the
// allowlisted relay_provider_not_found diagnosis. The relay's outer HTTP 502
// is an envelope; the upstream itself returned HTTP 404 for this exact item.
// Other transport errors remain 502. Never echo a provider URL or response.
export function customerMediaFailureStatus({
  usingIndependentRelay=false,
  relayStatus=null,
  relayFailure=null
}={}){
  if(usingIndependentRelay&&relayStatus===502&&relayFailure==='relay_provider_not_found')
    return 404;
  return 502;
}

// Stable, credential-free diagnostic categories for upstream Xtream transport.
// These classifications never bypass source permissions or retry rejected media.
const DNS=new Set(['ENOTFOUND','EAI_AGAIN','ENODATA','EAI_NODATA']);
const REFUSED=new Set(['ECONNREFUSED']);
const RESET=new Set(['ECONNRESET','EPIPE','UND_ERR_SOCKET','UND_ERR_HEADERS_OVERFLOW']);
const TIMEOUT=new Set(['ETIMEDOUT','ESOCKETTIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
const TLS=new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED']);

export function classifyXtreamTransportError(error){
  // Never interpolate URLs, request headers, account IDs or raw exception text
  // into API error codes or logs. Follow only a shallow bounded cause chain.
  let cause=error;
  for(let i=0;i<4&&cause;i++,cause=cause.cause){
    const code=typeof cause.code==='string'?cause.code.toUpperCase():'';
    const name=typeof cause.name==='string'?cause.name:'';
    if(DNS.has(code))return 'xtream_transport_dns_failed';
    if(REFUSED.has(code))return 'xtream_transport_connection_refused';
    if(RESET.has(code))return 'xtream_transport_connection_reset';
    if(TIMEOUT.has(code)||name==='AbortError'||name==='TimeoutError')
      return 'xtream_transport_timeout';
    if(TLS.has(code))return 'xtream_transport_tls_invalid';
  }
  return 'xtream_transport_unreachable';
}

export function safeXtreamTransportCategory(error){
  if(!error||typeof error!=='object')return null;
  const message=typeof error.message==='string'?error.message:'';
  // Only wrap fetch/network errors; ordinary HTTP 401/403/404 and application
  // validation errors stay untouched and are never retried here.
  const cause=error.cause;
  if(cause||/^(?:fetch failed|network error|network request failed)$/i.test(message)
    ||error.name==='AbortError'||error.name==='TimeoutError')
    return classifyXtreamTransportError(error);
  return null;
}

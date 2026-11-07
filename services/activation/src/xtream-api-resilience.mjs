// One bounded reconnect for idempotent Xtream account metadata only.
// Media streaming, catalog downloads and permission-denied responses never
// pass through this helper: they must not be replayed without authorization.
const TRANSIENT=new Set([
  'xtream_transport_connection_reset','xtream_transport_timeout',
  'xtream_transport_dns_failed','xtream_transport_unreachable',
  'xtream_http_502','xtream_http_503','xtream_http_504'
]);
export function retryableXtreamAccountError(code){
  return typeof code==='string' && TRANSIENT.has(code);
}

export async function withXtreamAccountReconnect(fetchOnce,{
  maxAttempts=2,delayMs=450,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  describe=error=>String(error?.message||'')
}={}){
  if(typeof fetchOnce!=='function'||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>2)
    throw new Error('xtream_account_retry_configuration_invalid');
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{return await fetchOnce();}
    catch(error){
      const code=describe(error);
      if(attempt===maxAttempts||!retryableXtreamAccountError(code))throw error;
      await wait(delayMs);
    }
  }
  throw new Error('xtream_account_reconnect_unreachable');
}

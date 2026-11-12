// Fixed, customer-facing Xtream hostname. No user-supplied host is trusted.
// An invalid or unset configuration falls back to the existing request origin.
export function normalizeXtreamPublicOrigin(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const u=new URL(value.trim());
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
       (u.pathname!=='/'&&u.pathname!=='')||u.port)return null;
    if(!/^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i.test(u.hostname))return null;
    return u.origin;
  }catch{return null}
}
export function configuredXtreamPublicOrigin(fallback=''){
  return normalizeXtreamPublicOrigin(process.env.BLOFY_XTREAM_PUBLIC_ORIGIN)||fallback;
}

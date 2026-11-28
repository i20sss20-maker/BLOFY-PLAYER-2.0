// Admin-supplied HTTPS origins only. These are public DNS names, not IP
// literals, local names, credentials, paths, wildcards or non-default ports.
// This policy is used to restrict the isolated page's browser CSP.
export function externalPlaylistOrigins(raw){
 if(typeof raw!=='string'||raw.length>4096)return [];
 const parts=raw.split(',').map(x=>x.trim()).filter(Boolean);
 if(!parts.length||parts.length>32)return [];
 const result=new Set();
 for(const part of parts){
  try{
   const u=new URL(part),host=u.hostname;
   if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(host)||
      /(?:^|\.)(localhost|local|internal|test|invalid|onion)$/i.test(host))return [];
   result.add(u.origin);
  }catch{return []}
 }
 return [...result];
}

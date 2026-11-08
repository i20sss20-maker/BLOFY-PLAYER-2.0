// Minimal, tightly scoped bridge contracts shared only by the source admin API.
// Never serializes source credentials, provider account secrets or raw URLs.
import {timingSafeEqual} from 'node:crypto';
export function streamBridgeAuthorized(header, secret){
  if(typeof secret!=='string'||secret.length<40||typeof header!=='string'||
      !header.startsWith('Bearer '))return false;
  const input=Buffer.from(header.slice(7)),expected=Buffer.from(secret);
  return input.length===expected.length&&timingSafeEqual(input,expected);
}
const count=n=>Number.isFinite(Number(n))?Math.max(0,Math.min(100000000,Number(n))):0;
export function streamSafeSource(row){
  const c=row?.counts||{};
  const allowed=['online','offline','unknown','syncing','error'];
  return {
    id:String(row?.id||''),name:String(row?.name||'').slice(0,160),
    enabled:row?.enabled===true,publishCatalog:row?.publishCatalog===true,
    status:allowed.includes(row?.status)?row.status:'unknown',
    counts:{live:count(c.live),movie:count(c.movie),series:count(c.series)},
    syncing:row?.syncing===true,queued:row?.queued===true,
    lastTestAt:row?.lastTestAt??null,lastSyncAt:row?.lastSyncAt??null,
    mediaSummary:row?.mediaSummary?{
      live:row.mediaSummary.live?.ok===true,
      movie:row.mediaSummary.movie?.ok===true,
      series:row.mediaSummary.series?.ok===true
    }:null
  };
}
export function streamSafeCatalog(item){
  return {
    id:String(item?.id||'').slice(0,140),serverId:String(item?.serverId||''),
    name:String(item?.name||'').slice(0,220),
    type:['live','movie','series'].includes(item?.type)?item.type:'unknown',
    categoryName:String(item?.categoryName||'').slice(0,90),
    enabled:item?.enabled===true,
    containerExtension:String(item?.containerExtension||'').slice(0,12)
  };
}
export function streamSafeAccount(row){
  return {id:String(row?.id||''),label:String(row?.label||'').slice(0,160),
    username:String(row?.username||'').slice(0,128),sourceId:row?.source_id||null,
    enabled:row?.enabled===true,maxConnections:count(row?.max_connections),
    expiresAt:row?.expires_at?new Date(row.expires_at).getTime():null,
    lastUsedAt:row?.last_used_at?new Date(row.last_used_at).getTime():null
  };
}

// Private owner-only reconciliation of catalog keys against PostgreSQL's
// completed verified chunk manifests. This never reads Xtream nor S3 media.
// A verified MANIFEST does not prove current physical S3 object availability.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MEDIA=/^[A-Za-z0-9._:-]{1,128}$/;
const GATEWAY=/^[1-9][0-9]{0,11}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX=50;
const EMPTY=Object.freeze({status:'not_recorded',storedManifestVerified:false,
 physicalS3Checked:false});
function safeItems(items){
 if(!Array.isArray(items)||items.length<1||items.length>MAX)
  throw Error('private_reconcile_items_invalid');
 const seen=new Set();
 return items.map(item=>{
  if(!item||!['movie','episode'].includes(item.kind)||
      typeof item.id!=='string'||
      !(item.kind==='movie'?MEDIA:GATEWAY).test(item.id))
   throw Error('private_reconcile_item_invalid');
  const key=item.kind+':'+item.id;
  if(seen.has(key))throw Error('private_reconcile_duplicate');
  seen.add(key);return {kind:item.kind,id:item.id};
 });
}
function classify(row){
 if(!row)return {...EMPTY};
 const total=Number(row.expected_bytes);
 const copied=Number(row.bytes_copied);
 const chunks=Number(row.chunk_count);
 const done=row.state==='verified'&&Number.isSafeInteger(total)&&
  total>8192&&total<=4*1024**3&&copied===total&&
  Number.isSafeInteger(chunks)&&chunks>0&&chunks<=512&&
  SHA.test(String(row.verified_sha256||''))&&
  ['mkv','mp4','ts','avi'].includes(String(row.extension||''));
 const status=done?'verified_manifest':
   row.state==='verified'?'verification_inconsistent':
   row.state==='failed'?'copy_failed':'copy_incomplete';
 return {status,storedManifestVerified:done,
  physicalS3Checked:false,
  ...(Number.isSafeInteger(total)&&total>0?{expectedBytes:total}:{}),
  ...(Number.isSafeInteger(copied)&&copied>=0?{storedBytes:copied}:{}),
  ...(done?{chunks}:{}),
  needsCurrentObjectProbe:done};
}
async function queryOrEmpty(db,statement,args){
 try{return (await db.query(statement,args)).rows||[]}
 catch(error){
  // A fresh service may not yet have initiated its private copy tables.
  if(error?.code==='42P01')return [];
  throw error;
 }
}
export async function reconcilePrivateVerifiedManifests(db,{
 sourceId,items
}={}){
 if(!UUID.test(String(sourceId||''))||
    !db||typeof db.query!=='function')
  throw Error('private_reconcile_scope_invalid');
 const scoped=safeItems(items);
 const movies=scoped.filter(x=>x.kind==='movie').map(x=>x.id);
 const episodes=scoped.filter(x=>x.kind==='episode').map(x=>Number(x.id));
 const results=new Map(scoped.map(x=>[x.kind+':'+x.id,{...EMPTY}]));
 if(movies.length){
  const rows=await queryOrEmpty(db,
    "SELECT DISTINCT ON (media_id) "+
    "media_id,state,extension,expected_bytes,bytes_copied, "+
    "verified_sha256,jsonb_array_length(parts) AS chunk_count "+
    "FROM blofy_content_hub_chunk_runs "+
    "WHERE source_id=$1 AND media_id=ANY($2::text[]) "+
    "ORDER BY media_id, "+
    "CASE WHEN state='verified' THEN 0 ELSE 1 END, "+
    "updated_at DESC",[sourceId,movies]);
  for(const row of rows){
   const id=String(row.media_id||'');
   if(results.has('movie:'+id))results.set('movie:'+id,classify(row));
  }
 }
 if(episodes.length){
  const rows=await queryOrEmpty(db,
    "SELECT DISTINCT ON (gateway_id) "+
    "gateway_id,state,extension,expected_bytes,bytes_copied, "+
    "verified_sha256,jsonb_array_length(parts) AS chunk_count "+
    "FROM blofy_content_hub_episode_runs "+
    "WHERE source_id=$1 AND gateway_id=ANY($2::integer[]) "+
    "ORDER BY gateway_id, "+
    "CASE WHEN state='verified' THEN 0 ELSE 1 END, "+
    "updated_at DESC",[sourceId,episodes]);
  for(const row of rows){
   const id=String(row.gateway_id||'');
   if(results.has('episode:'+id))results.set('episode:'+id,classify(row));
  }
 }
 const rows=scoped.map(item=>({
  kind:item.kind,id:item.id,...results.get(item.kind+':'+item.id)
 }));
 return {ok:true,scope:'private_manifest_database_only',
  sourceId,items:rows,count:rows.length,
  manifestVerifiedCount:rows.filter(x=>x.storedManifestVerified).length,
  notRecordedCount:rows.filter(x=>x.status==='not_recorded').length,
  physicalS3Checked:false,providerRequests:0,
  mediaBytesTransferred:0,customerCutover:false,
  automaticCopyStarted:false};
}

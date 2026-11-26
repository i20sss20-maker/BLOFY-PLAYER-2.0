// Continuous source-bound Xtream catalog watcher. Checks category + item
// listings every minute when idle, but performs PostgreSQL imports ONLY when
// the provider's semantic listing actually changed. Never copies media.
// A PostgreSQL lease prevents duplicate work across Railway replicas.
import {createHash,randomUUID} from 'node:crypto';
import {normalizeXtreamCategory,normalizeXtreamItem,parseTopLevelJsonArray} from './xtream-core.mjs';
import {xtreamProviderOrder} from './xtream-provider-order.mjs';

export const MINUTE_MEDIA_TYPES=Object.freeze(['live','movie','series']);
const TABLE='blofy_xtream_minute_catalog_watch';
const FINGERPRINTS='blofy_xtream_minute_catalog_fingerprints';
const safeError=e=>{
 const code=String(e?.message||'');
 return [
  'xtream_catalog_empty_preserved','xtream_catalog_suspicious_drop_preserved',
  'xtream_http_401','xtream_http_403','xtream_http_404','xtream_http_429',
  'xtream_transport_unreachable','xtream_transport_timeout',
  'xtream_transport_connection_reset','xtream_array_incomplete',
  'xtream_provider_order_unavailable','minute_catalog_limit_exceeded'
 ].includes(code)?code:'minute_catalog_upstream_unavailable';
};

// Streaming SHA-256 over only fields actually imported by BLOFY. Stable across
// insignificant JSON key ordering; changes in category order, artwork,
// titles, additions, removals and metadata trigger a selective sync.
export async function fingerprintXtreamListing({mediaType,load,maxItems=350000}={}){
 if(!MINUTE_MEDIA_TYPES.includes(mediaType)||typeof load!=='function')
  throw new Error('minute_catalog_invalid_type');
 const hash=createHash('sha256');
 const inventory=Buffer.alloc(32); // order-insensitive IDs, unlike metadata/order fingerprint
 hash.update('blofy-xtream-listing-v1\n'+mediaType+'\n');
 const counts={categories:0,items:0};
 for(const kind of ['categories','items']){
  hash.update(kind+'\n');
  const response=await load(kind);
  if(!response?.body)throw new Error('minute_catalog_upstream_unavailable');
  const countKey=kind==='categories'?'categories':'items';
  await parseTopLevelJsonArray(response.body,async raw=>{
   const next=kind==='categories'
    ?normalizeXtreamCategory(mediaType,raw,'watch')
    :normalizeXtreamItem(mediaType,raw,'watch');
   if(!next)return;
   counts[countKey]++;
   if(counts[countKey]>(kind==='categories'?5000:maxItems))
    throw new Error('minute_catalog_limit_exceeded');
   const pos=xtreamProviderOrder(raw,counts[countKey],
    kind==='categories'?'category':'item');
   const record=kind==='categories'
    ?[next.sourceCategoryId,next.name,next.parentId,pos]
    :[next.sourceId,next.categoryId,next.name,next.iconUrl,
      next.containerExtension,next.metadata,pos];
   hash.update(JSON.stringify(record)+'\n');
   // Stream IDs, not titles or EPG metadata, decide whether new/deleted
   // content must be imported immediately. XOR is order-independent and
   // requires a fixed 32-byte accumulator even for a 300k-item provider.
   const id=(kind==='categories'?'c:':'i:')+
     (kind==='categories'?next.sourceCategoryId:next.sourceId);
   const digest=createHash('sha256').update(id).digest();
   for(let i=0;i<32;i++)inventory[i]^=digest[i];
  });
 }
 if(!counts.items)throw new Error('xtream_catalog_empty_preserved');
 return {mediaType,hash:hash.digest('hex'),inventoryHash:inventory.toString('hex'),...counts};
}

export function createMinuteCatalogWatcher({
 db,sourceById,approvedSource,fetchSnapshot,startSync,sourceBusy=()=>false,
 enabled=()=>false,onEvent=()=>{}
}={}){
 if(!db?.connect||!db?.query||typeof sourceById!=='function'||
   typeof approvedSource!=='function'||typeof fetchSnapshot!=='function'||
   typeof startSync!=='function')throw new Error('minute_catalog_dependencies_invalid');
 let schemaPromise=null,inProcess=false;
 async function ready(){
  if(schemaPromise)return schemaPromise;
  schemaPromise=(async()=>{
   const client=await db.connect();
   try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(718420691)');
    await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(
      source_id UUID PRIMARY KEY REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
      lease_token UUID,lease_until TIMESTAMPTZ,
      next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checked_at TIMESTAMPTZ,synced_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'starting',last_error TEXT,
      changed_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      checked_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${FINGERPRINTS}(
      source_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
      fingerprint TEXT NOT NULL,inventory_fingerprint TEXT,item_count INTEGER NOT NULL,
      category_count INTEGER NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(source_id,media_type))`);
    await client.query(`ALTER TABLE ${FINGERPRINTS}
      ADD COLUMN IF NOT EXISTS inventory_fingerprint TEXT`);
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
   finally{client.release();}
  })().catch(e=>{schemaPromise=null;throw e});
  return schemaPromise;
 }
 async function status(){
  const selection=await approvedSource();
  if(!selection?.ok)return{enabled:false,status:'source_unavailable'};
  if(!enabled())return{enabled:false,status:'disabled',sourceId:selection.sourceId};
  await ready();
  const [main,types]=await Promise.all([
   db.query(`SELECT status,checked_at,synced_at,next_check_at,last_error,
      changed_types,checked_counts
      FROM ${TABLE} WHERE source_id=$1`,[selection.sourceId]),
   db.query(`SELECT media_type,item_count,category_count,synced_at
      FROM ${FINGERPRINTS} WHERE source_id=$1`,[selection.sourceId])
  ]);
  const r=main.rows[0];
  return{
   enabled:true,sourceId:selection.sourceId,
   status:r?.status||'starting',checkedAt:r?.checked_at||null,
   syncedAt:r?.synced_at||null,nextCheckAt:r?.next_check_at||null,
   lastError:r?.last_error||null,changedTypes:r?.changed_types||[],
   checkedCounts:r?.checked_counts||{},
   importedTypes:types.rows.map(x=>({
    type:x.media_type,items:Number(x.item_count),
    categories:Number(x.category_count),syncedAt:x.synced_at
   }))
  };
 }
 async function tick(){
  if(!enabled()||inProcess)return{requested:false,code:'disabled_or_busy'};
  inProcess=true;
  let keepLease=false,heartbeat=null,source=null,token=null;
  const log=(code,extra={})=>onEvent({code,sourceId:source?.id||null,...extra,
    mediaFilesCopied:0,customerCutover:false});
  const finish=async({status='unchanged',error=null,changedTypes=[],counts={}}={})=>{
   if(!token||!source)return;
   await db.query(`UPDATE ${TABLE}
    SET lease_until=NULL,lease_token=NULL,next_check_at=NOW(),
      checked_at=NOW(),status=$3,last_error=$4,
      changed_types=$5::jsonb,checked_counts=$6::jsonb,updated_at=NOW()
    WHERE source_id=$1 AND lease_token=$2`,
    [source.id,token,status,error,JSON.stringify(changedTypes),JSON.stringify(counts)]);
  };
  const clear=()=>{if(heartbeat)clearInterval(heartbeat);inProcess=false;};
  try{
   const approved=await approvedSource();
   if(!approved?.ok)return{requested:false,code:'source_unapproved'};
   source=await sourceById(approved.sourceId);
   if(!source||source.name?.trim().toLowerCase()!=='saleh'||
      !source.enabled||!source.publish_catalog||source.deletion_requested_at)
    return{requested:false,code:'source_unapproved'};
   if(sourceBusy(source.id))return{requested:false,code:'source_busy'};
   // An admin import may run on a different Railway replica. Don't compete
   // with recently active source imports; a stale status is not a lock.
   if(source.status==='syncing'&&
     Date.now()-new Date(source.updated_at).getTime()<8*60_000)
    return{requested:false,code:'source_import_active'};
   await ready();
   token=randomUUID();
   const claim=await db.query(`INSERT INTO ${TABLE}
    (source_id,lease_token,lease_until,next_check_at,status,updated_at)
    VALUES($1,$2,NOW()+INTERVAL '4 minutes',NOW()+INTERVAL '1 minute','checking',NOW())
    ON CONFLICT (source_id) DO UPDATE SET
      lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,
      next_check_at=EXCLUDED.next_check_at,status='checking',updated_at=NOW()
    WHERE (${TABLE}.lease_until IS NULL OR ${TABLE}.lease_until<NOW())
      AND ${TABLE}.next_check_at<=NOW()
    RETURNING source_id`,[source.id,token]);
   if(!claim.rowCount)return{requested:false,code:'minute_not_due_or_locked'};
   heartbeat=setInterval(()=>{
    void db.query(`UPDATE ${TABLE} SET lease_until=NOW()+INTERVAL '4 minutes'
      WHERE source_id=$1 AND lease_token=$2`,[source.id,token]).catch(()=>{});
   },30000);
   heartbeat.unref?.();
   const known=await db.query(`SELECT media_type,fingerprint,inventory_fingerprint,
     item_count,category_count,synced_at
     FROM ${FINGERPRINTS} WHERE source_id=$1`,[source.id]);
   const prior=new Map(known.rows.map(r=>[r.media_type,r]));
   const changed=[],failures=[],counts={};
   for(const type of MINUTE_MEDIA_TYPES){
    if(!enabled()){failures.push('watch_disabled');break;}
    try{
     const snapshot=await fetchSnapshot(source,type);
     counts[type]={items:snapshot.items,categories:snapshot.categories};
     const prev=prior.get(type);
     if(prev&&Number(prev.item_count)>=50&&
        snapshot.items<Math.ceil(Number(prev.item_count)*0.1)){
      failures.push(type+':suspicious_drop_preserved');
      continue;
     }
     if(prev&&!prev.inventory_fingerprint&&prev.fingerprint===snapshot.hash){
       // Upgrade old fingerprints without rewriting an unchanged 300k catalog.
       await db.query(`UPDATE ${FINGERPRINTS}
         SET inventory_fingerprint=$3 WHERE source_id=$1 AND media_type=$2
           AND inventory_fingerprint IS NULL`,
        [source.id,type,snapshot.inventoryHash]);
       prev.inventory_fingerprint=snapshot.inventoryHash;
     }
     const structural=!prev||
       prev.inventory_fingerprint!==snapshot.inventoryHash||
       Number(prev.item_count)!==snapshot.items||
       Number(prev.category_count)!==snapshot.categories;
     const detailsChanged=Boolean(prev&&prev.fingerprint!==snapshot.hash);
     // A provider may reorder live rows or vary EPG-related fields every
     // minute. Scan every minute, but avoid massive DB rewrites for jitter.
     // New/removed IDs are still imported right away even at equal counts.
     const metadataDue=!prev||!Number.isFinite(new Date(prev.synced_at).getTime())||
       Date.now()-new Date(prev.synced_at).getTime()>=10*60_000;
     if(structural||(detailsChanged&&metadataDue))changed.push(snapshot);
    }catch(error){
     failures.push(type+':'+safeError(error));
    }
   }
   const selected=changed.map(x=>x.mediaType);
   if(!selected.length){
    const state=failures.length?'partial':'unchanged';
    await finish({status:state,error:failures.length?failures.join('; ').slice(0,250):null,
      counts});
    log(failures.length?'poll_partial':'poll_unchanged',{typesChecked:Object.keys(counts),
      failures:failures.length});
    return{requested:false,code:state};
   }
   if(sourceBusy(source.id)){
    await finish({status:'deferred',changedTypes:selected,counts});
    return{requested:false,code:'import_busy'};
   }
   await db.query(`UPDATE ${TABLE}
     SET status='importing',checked_at=NOW(),last_error=$3,
       changed_types=$4::jsonb,checked_counts=$5::jsonb,updated_at=NOW()
     WHERE source_id=$1 AND lease_token=$2`,
      [source.id,token,failures.length?failures.join('; ').slice(0,250):null,
       JSON.stringify(selected),JSON.stringify(counts)]);
   // Hand the durable lease to the import settlement callback. A crashed
   // replica releases its lease after the heartbeat stops.
   const sourceId=source.id,leaseToken=token;
   const callback=async({state,result})=>{
    try{
     const succeeded=changed.filter(x=>result?.details?.[x.mediaType]);
     for(const entry of succeeded){
      await db.query(`INSERT INTO ${FINGERPRINTS}
        (source_id,media_type,fingerprint,inventory_fingerprint,item_count,category_count,synced_at)
        VALUES($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT(source_id,media_type) DO UPDATE SET
          fingerprint=EXCLUDED.fingerprint,
          inventory_fingerprint=EXCLUDED.inventory_fingerprint,
          item_count=EXCLUDED.item_count,
          category_count=EXCLUDED.category_count,synced_at=NOW()`,
       [sourceId,entry.mediaType,entry.hash,entry.inventoryHash,entry.items,entry.categories]);
     }
     await db.query(`UPDATE ${TABLE}
       SET lease_token=NULL,lease_until=NULL,next_check_at=NOW(),
         status=$3,checked_at=COALESCE(checked_at,NOW()),
         synced_at=CASE WHEN $4 THEN NOW() ELSE synced_at END,
         last_error=$5,updated_at=NOW()
       WHERE source_id=$1 AND lease_token=$2`,
       [sourceId,leaseToken,state,succeeded.length>0,
        failures.length?failures.join('; ').slice(0,250):state==='failed'?'minute_catalog_import_failed':null]);
     log('import_'+state,{changedTypes:selected,syncedTypes:succeeded.map(x=>x.mediaType)});
    }finally{clear();}
   };
   try{
    const job=startSync(sourceId,selected,{onSettled:callback});
    if(typeof job?.queued!=='boolean')throw new Error('minute_catalog_queue_ack_missing');
    keepLease=true;
    log('import_accepted',{changedTypes:selected,queued:job.queued});
    return{requested:true,code:'import_accepted',types:selected,queued:job.queued};
   }catch(error){
    await finish({status:'deferred',error:safeError(error),changedTypes:selected,counts});
    log('import_not_queued',{types:selected});
    return{requested:false,code:'import_not_queued'};
   }
  }catch(error){
   await finish({status:'failed',error:safeError(error)}).catch(()=>{});
   log('poll_failed',{reason:safeError(error)});
   return{requested:false,code:'poll_failed'};
  }finally{if(!keepLease)clear();}
 }
 return{ready,tick,status};
}

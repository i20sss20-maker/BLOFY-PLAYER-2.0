// Durable, bounded management features for BLOFY STREAM.
// Never store or export upstream credentials or subscriber secrets.
import crypto from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA=new Set(['live','movie','series']);
const invalid=(name,status=400)=>Object.assign(new Error(name),{status});
const validId=value=>UUID.test(String(value||''));
const validName=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=80&&!/[\u0000-\u001f\u007f]/.test(value);
const sourceIds=xs=>Array.isArray(xs)&&xs.length>=1&&xs.length<=50&&xs.every(x=>typeof x==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(x))&&new Set(xs).size===xs.length;

export function validateStudioBulk(input){
  if(!validId(input?.serverId)||input?.mediaType!=='live'||!sourceIds(input.ids))throw invalid('studio_bulk_invalid');
  if(!['feature','unfeature','show','hide','renumber','clear_numbers'].includes(input.action))
    throw invalid('studio_bulk_action_invalid');
  const start=Number(input.startNumber);
  if(input.action==='renumber'&&(!Number.isInteger(start)||start<1||start+input.ids.length-1>99999))
    throw invalid('studio_bulk_number_invalid');
  return {serverId:input.serverId,ids:input.ids,action:input.action,startNumber:start};
}
export function validateStudioSchedule(body){
  const hours=Number(body?.intervalHours);
  if(typeof body?.enabled!=='boolean'||![6,12,24,48,168].includes(hours)||
     !Array.isArray(body.types)||body.types.length<1||body.types.length>3||
     body.types.some(x=>!MEDIA.has(x))||new Set(body.types).size!==body.types.length)
    throw invalid('studio_schedule_invalid');
  return {enabled:body.enabled,intervalHours:hours,types:body.types};
}
export function createStudioPro({pool,ensureXtreamReady,startSync}){
  let setup=null;
  async function ready(){
    await ensureXtreamReady();
    if(!setup)setup=(async()=>{
      const db=await pool.connect();
      try{
        await db.query('BEGIN');
        await db.query('SELECT pg_advisory_xact_lock(718420688)');
        await db.query('CREATE TABLE IF NOT EXISTS blofy_xtream_studio_snapshots (id UUID PRIMARY KEY,server_id UUID NOT NULL,label TEXT NOT NULL,data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
        await db.query('CREATE INDEX IF NOT EXISTS idx_xt_studio_snapshots ON blofy_xtream_studio_snapshots(server_id,created_at DESC)');
        await db.query('CREATE TABLE IF NOT EXISTS blofy_xtream_studio_collections (id UUID PRIMARY KEY,server_id UUID NOT NULL,media_type TEXT NOT NULL,name TEXT NOT NULL,item_ids JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
        await db.query('CREATE TABLE IF NOT EXISTS blofy_xtream_studio_schedules (server_id UUID PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,interval_hours INTEGER NOT NULL DEFAULT 24,types JSONB NOT NULL DEFAULT \'["live","movie","series"]\'::jsonb,next_run_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
        await db.query('CREATE TABLE IF NOT EXISTS blofy_xtream_studio_events (id BIGSERIAL PRIMARY KEY,server_id UUID NOT NULL,action TEXT NOT NULL,details JSONB NOT NULL DEFAULT \'{}\'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
        await db.query('CREATE INDEX IF NOT EXISTS idx_xt_studio_events ON blofy_xtream_studio_events(server_id,id DESC)');
        await db.query('COMMIT');
      }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
      finally{db.release()}
    })().catch(error=>{setup=null;throw error});
    return setup;
  }
  async function checkSource(serverId,db=pool){
    if(!validId(serverId))throw invalid('studio_source_invalid');
    const result=await db.query('SELECT id,name,enabled,publish_catalog,status,last_sync_at,counts FROM blofy_xtream_servers WHERE id=$1 AND deletion_requested_at IS NULL',[serverId]);
    if(!result.rows[0])throw invalid('studio_source_not_found',404);
    return result.rows[0];
  }
  async function record(serverId,action,details,db=pool){
    await db.query('INSERT INTO blofy_xtream_studio_events(server_id,action,details) VALUES($1,$2,$3::jsonb)',
      [serverId,action,JSON.stringify(details)]);
  }
  async function overview(serverId){
    await ready();
    const src=await checkSource(serverId);
    const [sample,collections,schedule,events]=await Promise.all([
      pool.query('SELECT media_type,COUNT(*)::int AS count,COUNT(*) FILTER(WHERE enabled=FALSE)::int AS hidden,COUNT(*) FILTER(WHERE featured=TRUE)::int AS featured,COUNT(*) FILTER(WHERE custom_name IS NOT NULL OR custom_icon_url IS NOT NULL)::int AS customized,COUNT(*) FILTER(WHERE COALESCE(icon_url,\'\')=\'\')::int AS missing_icon FROM (SELECT media_type,enabled,featured,custom_name,custom_icon_url,icon_url FROM blofy_xtream_items WHERE server_id=$1 ORDER BY source_id LIMIT 1200) sample GROUP BY media_type',[serverId]),
      pool.query('SELECT COUNT(*)::int AS count FROM blofy_xtream_studio_collections WHERE server_id=$1',[serverId]),
      pool.query('SELECT enabled,interval_hours,types,next_run_at FROM blofy_xtream_studio_schedules WHERE server_id=$1',[serverId]),
      pool.query('SELECT action,details,created_at FROM blofy_xtream_studio_events WHERE server_id=$1 ORDER BY id DESC LIMIT 15',[serverId])
    ]);
    return {source:{name:src.name,enabled:src.enabled,published:src.publish_catalog,status:src.status,lastSyncAt:src.last_sync_at,counts:src.counts},
      sampleOnly:true,sampleLimit:1200,byType:sample.rows,collectionCount:collections.rows[0].count,
      schedule:schedule.rows[0]||null,events:events.rows};
  }
  async function bulk(input){
    await ready();
    const {serverId,ids,action,startNumber}=validateStudioBulk(input);
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout='1300ms'");
      await db.query("SET LOCAL statement_timeout='9000ms'");
      await checkSource(serverId,db);
      const rows=(await db.query('SELECT source_id FROM blofy_xtream_items WHERE server_id=$1 AND media_type=\'live\' AND source_id=ANY($2::text[]) FOR UPDATE',[serverId,ids])).rows;
      if(rows.length!==ids.length)throw invalid('studio_bulk_missing_channels',409);
      let result;
      if(action==='renumber'){
        result=await db.query('UPDATE blofy_xtream_items i SET channel_number=$3+rank.ord::int-1,updated_at=NOW() FROM unnest($2::text[]) WITH ORDINALITY rank(source_id,ord) WHERE i.server_id=$1 AND i.media_type=\'live\' AND i.source_id=rank.source_id',[serverId,ids,startNumber]);
      }else{
        const fixed={feature:['featured',true],unfeature:['featured',false],show:['enabled',true],hide:['enabled',false],clear_numbers:['channel_number',null]}[action];
        result=await db.query('UPDATE blofy_xtream_items SET '+fixed[0]+'=$3,updated_at=NOW() WHERE server_id=$1 AND media_type=\'live\' AND source_id=ANY($2::text[])',[serverId,ids,fixed[1]]);
      }
      await record(serverId,'bulk_'+action,{count:ids.length},db);
      await db.query('COMMIT');
      return {updated:result.rowCount,action};
    }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
    finally{db.release()}
  }
  async function snapshot(serverId,label){
    await ready();
    await checkSource(serverId);
    if(!validName(label))throw invalid('studio_snapshot_label_invalid');
    const [cats,items]=await Promise.all([
      pool.query('SELECT media_type,source_category_id,enabled,sort_order FROM blofy_xtream_categories WHERE server_id=$1 ORDER BY media_type,source_category_id LIMIT 2001',[serverId]),
      pool.query('SELECT media_type,source_id,enabled,custom_name,custom_icon_url,featured,channel_number FROM blofy_xtream_items WHERE server_id=$1 AND (enabled=FALSE OR featured=TRUE OR custom_name IS NOT NULL OR custom_icon_url IS NOT NULL OR channel_number IS NOT NULL) ORDER BY media_type,source_id LIMIT 2001',[serverId])
    ]);
    if(cats.rows.length>2000||items.rows.length>2000)throw invalid('studio_snapshot_too_many_customizations',409);
    const data={version:1,serverId,categories:cats.rows,items:items.rows};
    const serialized=JSON.stringify(data);
    if(Buffer.byteLength(serialized)>1500000)throw invalid('studio_snapshot_too_large',409);
    const id=crypto.randomUUID();
    await pool.query('INSERT INTO blofy_xtream_studio_snapshots(id,server_id,label,data) VALUES($1,$2,$3,$4::jsonb)',
      [id,serverId,label.trim(),serialized]);
    await pool.query('DELETE FROM blofy_xtream_studio_snapshots WHERE id IN (SELECT id FROM blofy_xtream_studio_snapshots WHERE server_id=$1 ORDER BY created_at DESC,id DESC OFFSET 15 LIMIT 100)',[serverId]);
    await record(serverId,'snapshot_created',{id,categories:cats.rows.length,customItems:items.rows.length});
    return {id,label:label.trim(),categories:cats.rows.length,items:items.rows.length};
  }
  async function listSnapshots(serverId){
    await ready();await checkSource(serverId);
    return (await pool.query('SELECT id,label,created_at,jsonb_array_length(data->\'categories\') AS categories,jsonb_array_length(data->\'items\') AS items FROM blofy_xtream_studio_snapshots WHERE server_id=$1 ORDER BY created_at DESC,id DESC LIMIT 15',[serverId])).rows.map(row=>({
      id:row.id,label:row.label,createdAt:row.created_at,categories:Number(row.categories),items:Number(row.items)
    }));
  }
  async function restore(serverId,snapshotId){
    await ready();if(!validId(snapshotId))throw invalid('studio_snapshot_id_invalid');
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout='1300ms'");
      await db.query("SET LOCAL statement_timeout='24000ms'");
      await checkSource(serverId,db);
      const row=(await db.query('SELECT data FROM blofy_xtream_studio_snapshots WHERE server_id=$1 AND id=$2 FOR UPDATE',[serverId,snapshotId])).rows[0];
      if(!row)throw invalid('studio_snapshot_not_found',404);
      const data=row.data;
      if(data.version!==1||data.serverId!==serverId||!Array.isArray(data.categories)||!Array.isArray(data.items)||data.items.length>2000||data.categories.length>2000)
        throw invalid('studio_snapshot_invalid',409);
      const count=(await db.query('SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM blofy_xtream_items WHERE server_id=$1 AND (enabled=FALSE OR featured=TRUE OR custom_name IS NOT NULL OR custom_icon_url IS NOT NULL OR channel_number IS NOT NULL) LIMIT 2001) q',[serverId])).rows[0].n;
      if(count>2000)throw invalid('studio_restore_too_many_overrides',409);
      await db.query('UPDATE blofy_xtream_items SET enabled=TRUE,featured=FALSE,custom_name=NULL,custom_icon_url=NULL,channel_number=NULL,updated_at=NOW() WHERE server_id=$1 AND (enabled=FALSE OR featured=TRUE OR custom_name IS NOT NULL OR custom_icon_url IS NOT NULL OR channel_number IS NOT NULL)',[serverId]);
      await db.query('UPDATE blofy_xtream_categories SET enabled=TRUE,sort_order=100000,updated_at=NOW() WHERE server_id=$1',[serverId]);
      await db.query('UPDATE blofy_xtream_items i SET enabled=x.enabled,featured=x.featured,custom_name=x.custom_name,custom_icon_url=x.custom_icon_url,channel_number=x.channel_number,updated_at=NOW() FROM jsonb_to_recordset($2::jsonb) AS x(media_type text,source_id text,enabled boolean,custom_name text,custom_icon_url text,featured boolean,channel_number integer) WHERE i.server_id=$1 AND i.media_type=x.media_type AND i.source_id=x.source_id',[serverId,JSON.stringify(data.items)]);
      await db.query('UPDATE blofy_xtream_categories c SET enabled=x.enabled,sort_order=x.sort_order,updated_at=NOW() FROM jsonb_to_recordset($2::jsonb) AS x(media_type text,source_category_id text,enabled boolean,sort_order integer) WHERE c.server_id=$1 AND c.media_type=x.media_type AND c.source_category_id=x.source_category_id',[serverId,JSON.stringify(data.categories)]);
      await record(serverId,'snapshot_restored',{snapshotId},db);
      await db.query('COMMIT');
      return {restored:true,categories:data.categories.length,items:data.items.length};
    }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
    finally{db.release()}
  }
  async function collections(serverId){
    await ready();await checkSource(serverId);
    return (await pool.query('SELECT id,name,media_type,item_ids,created_at FROM blofy_xtream_studio_collections WHERE server_id=$1 ORDER BY created_at DESC LIMIT 50',[serverId])).rows.map(row=>({
      id:row.id,name:row.name,mediaType:row.media_type,itemCount:row.item_ids?.length||0,createdAt:row.created_at
    }));
  }
  async function addCollection(body){
    await ready();const serverId=body?.serverId;await checkSource(serverId);
    if(!validName(body.name)||!MEDIA.has(body.mediaType)||!Array.isArray(body.itemIds)||body.itemIds.length<1||body.itemIds.length>100||
      body.itemIds.some(x=>typeof x!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(x))||new Set(body.itemIds).size!==body.itemIds.length)
      throw invalid('studio_collection_invalid');
    const matches=(await pool.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_items WHERE server_id=$1 AND media_type=$2 AND source_id=ANY($3::text[])',[serverId,body.mediaType,body.itemIds])).rows[0].n;
    if(matches!==body.itemIds.length)throw invalid('studio_collection_items_missing',409);
    const id=crypto.randomUUID();
    await pool.query('INSERT INTO blofy_xtream_studio_collections(id,server_id,media_type,name,item_ids) VALUES($1,$2,$3,$4,$5::jsonb)',
      [id,serverId,body.mediaType,body.name.trim(),JSON.stringify(body.itemIds)]);
    await record(serverId,'collection_created',{id,count:body.itemIds.length});
    return{id,name:body.name.trim(),count:body.itemIds.length,adminOnly:true};
  }
  async function deleteCollection(serverId,id){
    await ready();await checkSource(serverId);
    if(!validId(id))throw invalid('studio_collection_id_invalid');
    const result=await pool.query('DELETE FROM blofy_xtream_studio_collections WHERE server_id=$1 AND id=$2',[serverId,id]);
    if(!result.rowCount)throw invalid('studio_collection_not_found',404);
    await record(serverId,'collection_deleted',{id});
    return{deleted:true};
  }
  async function schedule(serverId){
    await ready();await checkSource(serverId);
    const row=(await pool.query('SELECT enabled,interval_hours,types,next_run_at FROM blofy_xtream_studio_schedules WHERE server_id=$1',[serverId])).rows[0];
    return row?{enabled:row.enabled,intervalHours:row.interval_hours,types:row.types,nextRunAt:row.next_run_at}:
      {enabled:false,intervalHours:24,types:['live','movie','series'],nextRunAt:null};
  }
  async function setSchedule(serverId,body){
    await ready();await checkSource(serverId);
    const cfg=validateStudioSchedule(body);
    await pool.query('INSERT INTO blofy_xtream_studio_schedules(server_id,enabled,interval_hours,types,next_run_at) VALUES($1,$2,$3,$4::jsonb,CASE WHEN $2 THEN NOW()+($3 * INTERVAL \'1 hour\') ELSE NULL END) ON CONFLICT(server_id) DO UPDATE SET enabled=EXCLUDED.enabled,interval_hours=EXCLUDED.interval_hours,types=EXCLUDED.types,next_run_at=EXCLUDED.next_run_at,updated_at=NOW()',
      [serverId,cfg.enabled,cfg.intervalHours,JSON.stringify(cfg.types)]);
    await record(serverId,'schedule_updated',{enabled:cfg.enabled,hours:cfg.intervalHours,types:cfg.types});
    return schedule(serverId);
  }
  async function tick(){
    await ready();
    const db=await pool.connect();let due=[];
    try{
      await db.query('BEGIN');
      await db.query("SET LOCAL statement_timeout='3000ms'");
      due=(await db.query('SELECT q.server_id,q.interval_hours,q.types FROM blofy_xtream_studio_schedules q JOIN blofy_xtream_servers s ON s.id=q.server_id WHERE q.enabled=TRUE AND q.next_run_at<=NOW() AND s.enabled=TRUE AND s.deletion_requested_at IS NULL AND s.status<>\'syncing\' ORDER BY q.next_run_at FOR UPDATE OF q SKIP LOCKED LIMIT 2')).rows;
      for(const cfg of due)await db.query('UPDATE blofy_xtream_studio_schedules SET next_run_at=NOW()+($2 * INTERVAL \'1 hour\'),updated_at=NOW() WHERE server_id=$1',[cfg.server_id,cfg.interval_hours]);
      await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
    finally{db.release()}
    for(const cfg of due){
      try{startSync(cfg.server_id,cfg.types);await record(cfg.server_id,'scheduled_sync_started',{types:cfg.types})}
      catch{await record(cfg.server_id,'scheduled_sync_skipped',{reason:'busy'}).catch(()=>{})}
    }
    return due.length;
  }
  return{ready,overview,bulk,snapshot,listSnapshots,restore,collections,addCollection,deleteCollection,schedule,setSchedule,tick};
}

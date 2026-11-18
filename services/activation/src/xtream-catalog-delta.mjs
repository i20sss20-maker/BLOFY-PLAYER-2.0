// Read-only, account-scoped, paginated catalog changes. A source owns its
// revision; a subscriber can never choose arbitrary source IDs or upstream URLs.
// This module does not download media or change issued codes.
import {formatGatewayItem,formatGatewayCategory} from './xtream-gateway-core.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TYPES=new Set(['live','movie','series']);
const PARTS=new Set(['categories','items','removed']);
const nat=v=>/^(0|[1-9][0-9]{0,15})$/.test(String(v))&&
  Number.isSafeInteger(Number(v));

export function parseXtreamCatalogDeltaRequest({kind,part,since,revision,after}={}){
 if(!TYPES.has(String(kind))||!PARTS.has(String(part))||
    !nat(since)||!nat(revision)||!nat(after??0))
  return null;
 return {kind,part,since:Number(since),revision:Number(revision),
   after:Number(after||0)};
}

/**
 * Query a stable complete catalog revision. Updating a category/item does not
 * mark every old row as changed. Source syncs are hidden while status=syncing.
 * Exact gateway IDs and content metadata are reused from regular player_api.
 */
export async function xtreamCatalogDeltaPage(pool,sourceId,input,{hiddenIds=null}={}){
 const args=parseXtreamCatalogDeltaRequest(input);
 if(!UUID.test(String(sourceId||''))||!args)
  return {ok:false,code:'catalog_delta_invalid_request',status:400};
 const {kind,part,since,revision,after}=args;
 const current=(await pool.query(`SELECT s.enabled,s.publish_catalog,s.status,
    v.revision,v.updated_at
    FROM blofy_xtream_servers s
    JOIN blofy_xtream_catalog_revisions v ON v.source_id=s.id
    WHERE s.id=$1 AND s.deletion_requested_at IS NULL`,[sourceId])).rows[0];
 if(!current||!current.enabled||!current.publish_catalog)
  return {ok:false,code:'catalog_delta_source_unavailable',status:404};
 if(current.status!=='online')
  return {ok:false,code:'catalog_delta_source_busy',status:503};
 const latest=Number(current.revision);
 if(!Number.isSafeInteger(latest)||latest<1)
  return {ok:false,code:'catalog_delta_not_ready',status:409};
 if(revision!==latest||since>latest)
  return {ok:false,code:'catalog_delta_revision_changed',status:409,
    revision:latest};
 if(since===latest)return {ok:true,revision:latest,kind,part,
   items:[],nextCursor:null,complete:true};
 let earlier=null;
 if(since!==0){
  const from=(await pool.query(`SELECT updated_at FROM
    blofy_xtream_catalog_revision_history
    WHERE source_id=$1 AND revision=$2`,[sourceId,since])).rows[0];
  if(!from)return {ok:false,code:'catalog_delta_baseline_missing',
    status:409,requiresFullReload:true};
  earlier=from.updated_at;
 }
 const select=part==='categories'?`m.gateway_id,c.name`:
   part==='items'?`m.gateway_id,i.server_id,i.source_id,i.category_id,
      COALESCE(NULLIF(i.custom_name,''),i.name) AS name,
      COALESCE(NULLIF(i.custom_icon_url,''),i.icon_url) AS icon_url,
      i.featured,i.channel_number,i.container_extension,i.metadata,
      cm.gateway_id AS category_gateway_id`:
     'm.gateway_id';
 let query;
 if(part==='categories'){
   query=`SELECT ${select}
    FROM blofy_xtream_gateway_category_map m
    JOIN blofy_xtream_categories c ON c.server_id=m.server_id
      AND c.media_type=m.media_type AND c.source_category_id=m.source_category_id
    WHERE m.server_id=$1 AND m.media_type=$2 AND m.gateway_id>$3
      AND c.enabled=TRUE AND c.updated_at <= $5
      AND ($4::timestamptz IS NULL OR c.updated_at>$4)
    ORDER BY m.gateway_id LIMIT 121`;
 }else if(part==='items'){
   query=`SELECT ${select}
    FROM blofy_xtream_gateway_item_map m
    JOIN blofy_xtream_items i ON i.server_id=m.server_id
      AND i.media_type=m.media_type AND i.source_id=m.source_id
    LEFT JOIN blofy_xtream_gateway_category_map cm
      ON cm.server_id=i.server_id AND cm.media_type=i.media_type
      AND cm.source_category_id=i.category_id
    WHERE m.server_id=$1 AND m.media_type=$2 AND m.gateway_id>$3
      AND i.enabled=TRUE AND i.updated_at <= $5
      AND ($4::timestamptz IS NULL OR i.updated_at>$4)
    ORDER BY m.gateway_id LIMIT 121`;
 }else{
   query=`SELECT ${select}
    FROM blofy_xtream_catalog_removals d
    JOIN blofy_xtream_gateway_item_map m ON m.server_id=d.source_id
      AND m.media_type=d.media_type AND m.source_id=d.source_item_id
    WHERE d.source_id=$1 AND d.media_type=$2 AND m.gateway_id>$3
      AND d.removed_at <= $5
      AND ($4::timestamptz IS NULL OR d.removed_at>$4)
      AND NOT EXISTS(SELECT 1 FROM blofy_xtream_items i
        WHERE i.server_id=d.source_id AND i.media_type=d.media_type
          AND i.source_id=d.source_item_id AND i.enabled=TRUE)
    ORDER BY m.gateway_id LIMIT 121`;
 }
 const rows=(await pool.query(query,[sourceId,kind,after,earlier,current.updated_at])).rows;
 const page=rows.slice(0,120);
 const visible=part==='items'&&hiddenIds instanceof Set?
    page.filter(row=>!hiddenIds.has(String(row.source_id))):page;
 const entries=part==='categories'?visible.map(formatGatewayCategory):
   part==='items'?visible.map(x=>formatGatewayItem(kind,x)):
     visible.map(x=>Number(x.gateway_id));
 const more=rows.length>120;
 return {ok:true,revision:latest,kind,part,items:entries,
   nextCursor:more?Number(page.at(-1).gateway_id):null,complete:!more};
}

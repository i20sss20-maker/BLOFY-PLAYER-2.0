// Read-only verification of existing gateway IDs. This never opens media,
// creates sessions, decrypts source credentials or changes customer routing.
// The caller MUST authenticate the Xtream account or device-bound STREAM token
// using the existing gateway before calling this function.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid=v=>typeof v==='string'&&UUID.test(v)?v.toLowerCase():null;
const kinds=new Set(['live','movie','series','episode']);
const fail=(status,code)=>({status,body:{ok:false,code,customerCutover:false}});
const itemSql=`SELECT i.source_id AS item_id,s.id AS server_id
 FROM blofy_xtream_gateway_item_map m
 JOIN blofy_xtream_items i ON i.server_id=m.server_id AND i.media_type=m.media_type AND i.source_id=m.source_id
 JOIN blofy_xtream_servers s ON s.id=i.server_id
 LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
 WHERE m.gateway_id=$1 AND m.media_type=$2 AND m.server_id=$3
 AND i.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE
 AND s.deletion_requested_at IS NULL AND (c.enabled IS NULL OR c.enabled=TRUE) LIMIT 1`;
const episodeSql=`SELECT i.source_id AS item_id,s.id AS server_id
 FROM blofy_xtream_gateway_episode_map e
 JOIN blofy_xtream_items i ON i.server_id=e.server_id AND i.media_type='series' AND i.source_id=e.series_source_id
 JOIN blofy_xtream_servers s ON s.id=i.server_id
 LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
 WHERE e.gateway_id=$1 AND i.media_type=$2 AND e.server_id=$3
 AND i.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE
 AND s.deletion_requested_at IS NULL AND (c.enabled IS NULL OR c.enabled=TRUE) LIMIT 1`;
export async function inspectLinodeGatewayMapping(db,account,{kind,gatewayId}={},{
 env=process.env,now=Date.now(),isHidden
}={}){
 if(env.BLOFY_LINODE_MAPPING_QA!=='1')return fail(404,'not_found');
 const accountId=uuid(account?.id),sourceId=uuid(account?.source_id);
 const expires=new Date(account?.expires_at??0).getTime();
 if(!accountId||accountId!==uuid(env.BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID)||
    !sourceId||sourceId!==uuid(env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID)||
    account?.enabled!==true||!Number.isFinite(now)||!Number.isFinite(expires)||expires<=now)
   return fail(404,'not_found');
 if(!kinds.has(kind)||typeof gatewayId!=='string'||!/^[1-9][0-9]{0,15}$/.test(gatewayId)||
    !Number.isSafeInteger(Number(gatewayId)))return fail(400,'invalid_item');
 if(typeof isHidden!=='function')return fail(503,'mapping_unavailable');
 const mediaType=kind==='episode'?'series':kind;
 try{
   const rows=(await db.query(kind==='episode'?episodeSql:itemSql,[gatewayId,mediaType,sourceId])).rows;
   const row=rows?.[0];
   if(!row||uuid(row.server_id)!==sourceId||typeof row.item_id!=='string'||
     await isHidden(mediaType,row.item_id)!==false)return fail(404,'not_found');
   return {status:200,body:{ok:true,kind,gatewayId,accountVerified:true,
     sourceScoped:true,catalogMapped:true,mediaVerified:false,customerCutover:false}};
 }catch{return fail(503,'mapping_unavailable')}
}

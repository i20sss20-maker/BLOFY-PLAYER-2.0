// Optional, explicit canary for applying a merchant's HIDDEN saleh items to
// that merchant's own authorized Xtream / code subscribers. Not used in the
// ordinary production gateway until BOTH environment controls are set.
// Never removes provider content, changes media IDs or grants access.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_TYPES=new Set(['live','movie','series']);
const MAX_HIDDEN_IDS=10000;

export function createDistributorCustomerCatalog({
 pool,enabled=false,distributorAllowlist='',onError=()=>{}
}={}){
 if(!pool||typeof pool.query!=='function')
   throw Error('distributor_catalog_database_required');
 const allowed=new Set(String(distributorAllowlist||'').split(',')
   .map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x)));
 const active=enabled===true&&allowed.size>0;
 const validateKind=kind=>{
   if(!MEDIA_TYPES.has(kind))throw Error('distributor_catalog_kind_invalid');
   return kind;
 };
 async function forAccount(account){
   if(!active||!UUID.test(String(account?.id||''))||
     !UUID.test(String(account?.source_id||'')))return null;
   try{
     // Account ownership is established from the existing merchant issuance
     // ledger (including codes redeemed into an account), never client params.
     const result=await pool.query(`SELECT DISTINCT i.distributor_id::text AS distributor_id
       FROM blofy_stream_distributor_issues i
       LEFT JOIN blofy_xtream_gateway_duration_codes c
         ON i.kind='app' AND c.id=i.subject_id
       JOIN blofy_xtream_servers s ON s.id=$2::uuid
       WHERE s.enabled=TRUE AND s.publish_catalog=TRUE
         AND lower(btrim(s.name))='saleh'
         AND i.status='done'
         AND (
            (i.kind='xtream' AND i.subject_id=$1::uuid) OR
            (i.kind='app' AND c.account_id=$1::uuid)
         )
       LIMIT 2`,[String(account.id),String(account.source_id)]);
     const rows=result.rows||[];
     if(rows.length!==1)return null; // ambiguous ownership must never mix ACLs
     const distributorId=String(rows[0].distributor_id||'').toLowerCase();
     if(!allowed.has(distributorId))return null;
     return Object.freeze({distributorId,sourceId:String(account.source_id).toLowerCase()});
   }catch(e){
     // An outage of this optional feature must not break legacy subscribers.
     try{onError('distributor_catalog_scope_lookup_unavailable')}catch{}
     return null;
   }
 }
 async function hiddenIds(scope,type){
   validateKind(type);
   if(!active||!scope)return null;
   const results=await pool.query(`SELECT o.source_item_id
     FROM blofy_stream_distributor_library o
     JOIN blofy_xtream_items i ON i.server_id=$3::uuid
       AND i.media_type=$2 AND i.source_id=o.source_item_id AND i.enabled=TRUE
     WHERE o.distributor_id=$1::uuid AND o.media_type=$2 AND o.hidden=TRUE
     LIMIT $4`,[scope.distributorId,type,scope.sourceId,MAX_HIDDEN_IDS+1]);
   const rows=results.rows||[];
   if(rows.length>MAX_HIDDEN_IDS)throw Error('distributor_catalog_hidden_over_cap');
   return new Set(rows.map(x=>String(x.source_item_id)));
 }
 async function isHidden(scope,type,sourceItemId){
   validateKind(type);
   if(!active||!scope||sourceItemId==null)return false;
   const value=String(sourceItemId);
   if(!/^[A-Za-z0-9._-]{1,128}$/.test(value))return false;
   const result=await pool.query(`SELECT 1 FROM blofy_stream_distributor_library
     WHERE distributor_id=$1::uuid AND media_type=$2
       AND source_item_id=$3 AND hidden=TRUE LIMIT 1`,
     [scope.distributorId,type,value]);
   return (result.rows?.length||0)>0;
 }
 return {enabled:active,forAccount,hiddenIds,isHidden};
}

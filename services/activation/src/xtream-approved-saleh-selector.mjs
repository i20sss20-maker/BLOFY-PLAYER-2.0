// Strict source resolver for private BLOFY STREAM owner-only catalog, mirror
// intake and 04:00 metadata sync. Do not silently use an unrelated
// BLOFY_XTREAM_EGRESS_SOURCE_ID: that ID can refer to a relay/other provider.
// Select ONLY ONE active, published source with exact canonical name 'saleh'.
// Never accept a client-supplied source ID or return stored credentials.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function resolveExclusiveApprovedSaleh(db){
 if(typeof db?.query!=='function')return {ok:false,
  code:'approved_saleh_database_unavailable'};
 let result;
 try{
  result=await db.query([
   'SELECT id,enabled,publish_catalog,',
   'deletion_requested_at FROM blofy_xtream_servers',
   "WHERE lower(btrim(name))='saleh'",
   'ORDER BY id ASC LIMIT 2'
  ].join(' '));
 }catch{return {ok:false,code:'approved_saleh_query_unavailable'}}
 const rows=result.rows||[];
 if(rows.length>1)return {ok:false,
   code:'approved_saleh_ambiguous',candidateCount:2};
 const row=rows[0];
 if(!row)return {ok:false,code:'approved_saleh_not_found'};
 if(!UUID.test(String(row.id||''))||row.enabled!==true||
    row.publish_catalog!==true||row.deletion_requested_at)
  return {ok:false,code:'approved_saleh_not_active_published'};
 return {ok:true,sourceId:String(row.id).toLowerCase(),
  code:'approved_saleh_exact_source_pinned',
  oneSourceOnly:true};
}

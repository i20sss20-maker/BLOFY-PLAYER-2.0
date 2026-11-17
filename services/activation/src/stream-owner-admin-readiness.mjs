// Authenticated owner-only, zero-mutation proof of the authoritative
// STREAM code and reseller store. This does NOT issue/revoke/renew codes,
// change balances, migrate schemas or expose any subscriber or seller row.
// The normal code/distributor list APIs can initialize schema on reads;
// this proof intentionally bypasses those paths.
const STORES=Object.freeze([
 Object.freeze({id:'codes',name:'blofy_xtream_gateway_duration_codes',
  required:Object.freeze(['id','code_hash','code_hint','code_channel',
   'source_id','duration_days','expires_at','revoked_at'])}),
 Object.freeze({id:'distributors',name:'blofy_stream_distributors',
  required:Object.freeze(['id','username','password_hash','enabled',
   'credits','issued_count'])})
]);
export async function readOwnerAdminStoreReadiness({
 pool,checkedAt=()=>new Date().toISOString()
}={}){
 if(!pool||typeof pool.query!=='function')
  throw Error('stream_owner_admin_readiness_pool_required');
 const stores=[];
 for(const store of STORES){
  let tablePresent=false,requiredColumnsPresent=false,selectReady=false;
  let state='unavailable';
  try{
   // PostgreSQL catalog-only inspection; does not CREATE, ALTER or touch
   // real customer account data. Object identifiers are hardcoded here.
   const reg=await pool.query(
    'SELECT to_regclass($1::text) AS table_oid',
    ['public.'+store.name]);
   tablePresent=Boolean(reg.rows?.[0]?.table_oid);
   if(!tablePresent){state='table_missing';}
   else {
    const cols=await pool.query(
     'SELECT attname FROM pg_catalog.pg_attribute '+
     'WHERE attrelid=to_regclass($1::text) '+
     'AND attnum>0 AND NOT attisdropped',
     ['public.'+store.name]);
    const names=new Set((cols.rows||[]).map(x=>String(x.attname||'')));
    requiredColumnsPresent=store.required.every(n=>names.has(n));
    if(!requiredColumnsPresent)state='columns_incomplete';
    else{
     // Explicit constant table names only; no caller-supplied SQL. The
     // projection is a literal 1, not a username, code, secret, ID or row.
     await pool.query('SELECT 1 FROM public.'+store.name+' LIMIT 1');
     selectReady=true;state='readable';
    }
   }
  }catch{
   // Do not propagate the database exception, SQL, table contents or URL.
   state='database_unavailable';
  }
  stores.push({id:store.id,state,tablePresent,
   requiredColumnsPresent,selectReady});
 }
 return {
  ok:stores.every(x=>x.state==='readable'),
  scope:'authoritative_owner_postgresql_read_only',
  checkedAt:checkedAt(),stores,
  tableRowsReturned:false,credentialsReturned:false,
  customerWrites:0,schemaMutations:0,providerMediaRequests:0,
  codeIssuanceTested:false,codeRedemptionTested:false,
  distributorCreationTested:false,distributorCreditsChanged:false,
  customerCutover:false
 };
}

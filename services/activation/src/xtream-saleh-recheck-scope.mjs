// Metadata-only allowlist for background first-byte recovery checks.
// A configured/previously served source can remain disabled without being
// polled forever. The owner has selected only the published 'saleh' source.
// Fail closed if the catalogue database is unavailable; no media fetch here.
const SALEH_ID='d2bb0397-1c56-4751-adc9-1a17758022f6';
export async function activePublishedSalehRecheckIds(db,candidateIds){
  if(!db||typeof db.query!=='function'||!Array.isArray(candidateIds))
    throw new TypeError('xtream_recheck_invalid_request');
  const candidates=[...new Set(candidateIds.map(x=>String(x||'').toLowerCase()))]
    .filter(x=>x===SALEH_ID);
  if(!candidates.length)return new Set();
  const result=await db.query(`SELECT id::text AS id
    FROM blofy_xtream_servers
    WHERE id=$1::uuid AND lower(btrim(name))='saleh'
      AND enabled=TRUE AND publish_catalog=TRUE
      AND deletion_requested_at IS NULL LIMIT 1`,[SALEH_ID]);
  return new Set((result.rows||[]).filter(row=>
    String(row.id||'').toLowerCase()===SALEH_ID).map(()=>SALEH_ID));
}

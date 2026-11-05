// Xtream providers can repeat an ID within one list response. PostgreSQL's
// INSERT .. ON CONFLICT cannot update the same row twice in one statement.
// Keep the latest record for each exact normalized source ID per batch.
export function distinctXtreamRecords(rows, field) {
  if(!['sourceId','sourceCategoryId'].includes(field))
    throw new TypeError('invalid_xtream_unique_field');
  const seen=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    if(!row||typeof row!=='object')continue;
    const id=String(row[field]??'').trim();
    if(!id)continue;
    seen.set(id,{...row,[field]:id});
  }
  return [...seen.values()];
}

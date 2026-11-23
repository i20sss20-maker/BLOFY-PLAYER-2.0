// Protect large ordered Xtream catalog pages against a tiny container /dev/shm.
// PostgreSQL parallel hash/sort workers can exhaust POSIX shared memory even
// when the Postgres process itself uses only a fraction of its RAM limit.
//
// SET LOCAL is scoped to one read-only transaction on one reserved pool client.
// It never changes the database configuration or leaks into later requests.
export async function queryXtreamCatalogPageNoParallel(pool,page){
 if(typeof pool?.connect!=='function'||
   typeof page?.text!=='string'||!Array.isArray(page.values))
  throw Error('xtream_catalog_page_invalid');
 const client=await pool.connect();
 let broken=false;
 try{
  await client.query('BEGIN READ ONLY');
  await client.query('SET LOCAL max_parallel_workers_per_gather = 0');
  const result=await client.query(page);
  await client.query('COMMIT');
  return result.rows;
 }catch(error){
  try{await client.query('ROLLBACK')}catch{broken=true}
  throw error;
 }finally{
  client.release(broken);
 }
}

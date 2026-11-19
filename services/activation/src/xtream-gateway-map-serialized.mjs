// Serialize large Xtream gateway map writes only when explicitly enabled.
// This limits overlapping PostgreSQL map INSERTs across deployment replicas
// and avoids parallel-query dynamic shared memory for the large catalog scan.
// The transaction retains all existing gateway IDs and on-conflict behavior.
export async function writeGatewayMapWithGuard(pool,sql,params,{enabled=false}={}){
 if(!pool?.query||typeof sql!=='string'||!Array.isArray(params))
  throw Error('xtream_gateway_map_write_invalid');
 if(!enabled)return pool.query(sql,params);
 if(!pool.connect)throw Error('xtream_gateway_map_pool_unavailable');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SET LOCAL max_parallel_workers_per_gather=0');
  await client.query("SET LOCAL work_mem='4MB'");
  await client.query('SELECT pg_advisory_xact_lock(718420927)');
  const result=await client.query(sql,params);
  await client.query('COMMIT');
  return result;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}

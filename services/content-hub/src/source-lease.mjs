import pg from 'pg';

// Session-bound PostgreSQL advisory lock, not a TTL: if the worker dies,
// Postgres releases its lock. One Content Hub writer per exact source.
// This cannot block other software (e.g. a provider's independent live
// origin), so the worker also requires a separate upstream-quota check.
export function createSourceLease({connectionString,
  Pool=pg.Pool,applicationName='blofy-content-hub'}={}){
 if(!connectionString)throw Error('content_hub_db_required');
 const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,application_name:applicationName});
 return {
  async health(){
   const result=await pool.query('SELECT 1 AS ok');
   return Number(result.rows?.[0]?.ok)===1;
  },
  async acquire(sourceName){
   if(sourceName!=='saleh')throw Error('content_hub_source_invalid');
   const client=await pool.connect();
   let held=false;
   try{
    const lock=await client.query(`SELECT pg_try_advisory_lock(
       hashtext('blofy_content_hub_writer'),hashtext($1)) AS acquired`,
       [sourceName]);
    held=lock.rows?.[0]?.acquired===true;
    if(!held){client.release();return null}
    let released=false;
    return {release:async()=>{
      if(released)return;
      released=true;
      try{
        await client.query(`SELECT pg_advisory_unlock(
          hashtext('blofy_content_hub_writer'),hashtext($1))`,[sourceName]);
      }finally{client.release()}
    }};
   }catch(error){
    client.release(error);throw Error('content_hub_lock_unavailable');
   }
  },
  async close(){await pool.end()}
 };
}

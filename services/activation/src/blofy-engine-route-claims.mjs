import {randomUUID} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const actions=new Set(['hold','retry_with_fresh_snapshot','feed_ready','attached']);
// Explicit migration for isolated QA; never invoked by production startup.
// Outstanding claims do not expire into automatic execution permissions.
export async function ensureEngineRouteClaims(db){
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_engine_route_claims (
 request_id uuid PRIMARY KEY, source_id uuid NOT NULL,
 token uuid NOT NULL UNIQUE, state text NOT NULL CHECK(state IN ('claimed','finished')),
 action text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
 )`);
}
export function createEngineRouteClaims(db,{enabled=false,sourceId:allowedSource}={}){
 return {
  async claim({requestId,sourceId}={}){
   if(!enabled||!uuid.test(allowedSource??'')||sourceId!==allowedSource||!uuid.test(requestId??''))return {acquired:false};
   const token=randomUUID();
   const r=await db.query(`INSERT INTO blofy_engine_route_claims(request_id,source_id,token,state)
    VALUES($1,$2,$3,'claimed') ON CONFLICT(request_id) DO NOTHING RETURNING token`,[requestId,sourceId,token]);
   return r.rowCount===1?{acquired:true,token}:{acquired:false};
  },
  async finish({token,result}={}){
   if(!enabled||!uuid.test(allowedSource??'')||!uuid.test(token??'')||!actions.has(result?.action))return false;
   const r=await db.query(`UPDATE blofy_engine_route_claims SET state='finished',action=$3,finished_at=now()
    WHERE token=$1 AND source_id=$2 AND state='claimed' RETURNING token`,[token,allowedSource,result.action]);
   return r.rowCount===1;
  }
 };
}
// An unresolved claim needs trusted reconciliation; never silently clear it.
// This is per-request deduplication, not source-wide capacity admission.

import crypto from 'node:crypto';

// The same transaction lock already used by paid issuance/reissue.
// Call under this lock on the SAME database and transaction before insertion.
export const SHARED_CODE_LOCK_SQL='SELECT pg_advisory_xact_lock(718420682)';
export function unifiedNamespaceEnabled(){
 return process.env.BLOFY_STREAM_UNIFIED_LOGIN_QA==='1';
}
const overlap=code=>/^(?:[0-9]{8}|[0-9]{12})$/.test(code);
function proof(code,keyHex,domain){
 if(!/^[0-9a-f]{64}$/i.test(String(keyHex||'')))
  throw Object.assign(Error('stream_code_namespace_unavailable'),{status:503});
 return crypto.createHmac('sha256',Buffer.from(keyHex,'hex')).update(domain).update(code).digest('hex');
}
export async function conflictsWithConnect(db,code,{enabled=unifiedNamespaceEnabled(),keyHex=process.env.BLOFY_STREAM_CONNECT_KEY}={}){
 if(!enabled||!overlap(code))return false;
 const hash=proof(code,keyHex,'blofy-connect:numeric:v1:');
 const table=await db.query("SELECT to_regclass('blofy_connect_pairings') AS relation");
 if(!table.rows[0]?.relation)return false;
 const found=await db.query('SELECT 1 FROM blofy_connect_pairings WHERE code_hash=$1 AND expires_at>NOW() LIMIT 1',[hash]);
 return found.rows.length>0;
}
export async function conflictsWithPaid(db,code,{enabled=unifiedNamespaceEnabled(),keyHex=process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY}={}){
 if(!enabled||!overlap(code))return false;
 const hash=proof(code,keyHex,'blofy-stream-subscription:v1:');
 // Paid table is authoritative, including expired and revoked vouchers.
 const found=await db.query('SELECT 1 FROM blofy_xtream_gateway_duration_codes WHERE code_hash=$1 LIMIT 1',[hash]);
 return found.rows.length>0;
}

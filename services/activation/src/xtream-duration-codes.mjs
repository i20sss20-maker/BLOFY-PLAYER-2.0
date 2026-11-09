// BLOFY STREAM subscriptions: duration begins ONLY at first successful
// redemption. Codes are high-entropy, stored as HMAC proofs, and cannot be
// redeemed twice. Passwords for resulting Xtream accounts remain one-way
// proofs; new credentials are shown once to the redeemer, never in lists.
import crypto from 'node:crypto';
import {gatewayCredentialProof,generateGatewayUsername,
  generateGatewayPassword} from './xtream-gateway-core.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_DAYS=730;
export function normalizeStreamCode(value){
  const code=String(value||'').trim().toUpperCase().replace(/[\s-]+/g,'');
  return /^[A-F0-9]{24}$/.test(code)?code:null;
}
export function streamCodeProof(value,keyHex){
  const code=normalizeStreamCode(value);
  if(!code||!/^[a-fA-F0-9]{64}$/.test(String(keyHex||'')))return null;
  return crypto.createHmac('sha256',Buffer.from(keyHex,'hex'))
    .update('blofy-stream-subscription:v1:').update(code).digest('hex');
}
export function validateStreamCodeBatch(data={}){
  const durationDays=Number(data.durationDays);
  const quantity=Number(data.quantity??1);
  const maxConnections=Number(data.maxConnections??1);
  if(!Number.isSafeInteger(durationDays)||durationDays<1||durationDays>MAX_DAYS)
    throw Object.assign(Error('stream_code_duration_invalid'),{status:400});
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>20)
    throw Object.assign(Error('stream_code_quantity_invalid'),{status:400});
  if(!Number.isSafeInteger(maxConnections)||maxConnections<1||maxConnections>20)
    throw Object.assign(Error('stream_code_connections_invalid'),{status:400});
  const sourceId=data.sourceId==null||data.sourceId===''?null:String(data.sourceId);
  if(sourceId&&!UUID.test(sourceId))
    throw Object.assign(Error('stream_code_source_invalid'),{status:400});
  const label=String(data.label||'BLOFY STREAM').trim().replace(/[\x00-\x1f\x7f]/g,' ').slice(0,100)||'BLOFY STREAM';
  return {durationDays,quantity,maxConnections,sourceId,label};
}
export function safeCodeRecord(row){
  return {
    id:row.id,label:String(row.label||'').slice(0,100),
    sourceId:row.source_id||null,durationDays:Number(row.duration_days),
    maxConnections:Number(row.max_connections),
    status:row.revoked_at?'revoked':row.redeemed_at?'redeemed':'unused',
    createdAt:row.created_at?new Date(row.created_at).getTime():null,
    redeemedAt:row.redeemed_at?new Date(row.redeemed_at).getTime():null,
    expiresAt:row.expires_at?new Date(row.expires_at).getTime():null,
    accountId:row.account_id||null,codeHint:row.code_hint||''
  };
}
export async function ensureStreamCodeTable(client){
  await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_duration_codes (
    id UUID PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    label TEXT NOT NULL,
    source_id UUID,
    duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 730),
    max_connections INTEGER NOT NULL CHECK(max_connections BETWEEN 1 AND 20),
    account_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    redeemed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CHECK (redeemed_at IS NULL OR (account_id IS NOT NULL AND expires_at IS NOT NULL)),
    CHECK (NOT (revoked_at IS NOT NULL AND redeemed_at IS NOT NULL))
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_blofy_stream_codes_created
    ON blofy_xtream_gateway_duration_codes(created_at DESC)`);
}
export function createStreamDurationCodes({pool,keyHex,clock=Date.now,
  randomBytes=crypto.randomBytes,uuid=crypto.randomUUID}={}){
  if(!pool||!/^[a-fA-F0-9]{64}$/.test(String(keyHex||'')))
    throw Error('stream_code_storage_not_ready');
  const checkedSource=async(db,sourceId)=>{
    if(!sourceId)return;
    const result=await db.query(`SELECT id FROM blofy_xtream_servers
      WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
        AND deletion_requested_at IS NULL LIMIT 1`,[sourceId]);
    if(!result.rows?.length)
      throw Object.assign(Error('stream_code_source_unavailable'),{status:409});
  };
  async function issue(data){
    const opts=validateStreamCodeBatch(data);
    const client=await pool.connect(),items=[];
    try{
      await client.query('BEGIN');
      await checkedSource(client,opts.sourceId);
      for(let i=0;i<opts.quantity;i++){
        const code=randomBytes(12).toString('hex').toUpperCase();
        const hash=streamCodeProof(code,keyHex),id=uuid();
        const row=(await client.query(`INSERT INTO blofy_xtream_gateway_duration_codes
          (id,code_hash,code_hint,label,source_id,duration_days,max_connections)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[
          id,hash,code.slice(0,4)+'••••'+code.slice(-4),opts.label,
          opts.sourceId,opts.durationDays,opts.maxConnections
        ])).rows[0];
        items.push({...safeCodeRecord(row),code});
      }
      await client.query('COMMIT');
      return {ok:true,items,count:items.length,redeemUrl:'https://blofyplayer.com/stream/activate'};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
  }
  async function list({limit=100,offset=0}={}){
    const n=Math.max(1,Math.min(200,Number(limit)||100));
    const start=Math.max(0,Math.min(100000,Number(offset)||0));
    const result=await pool.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
      ORDER BY created_at DESC LIMIT $1 OFFSET $2`,[n,start]);
    const totals=await pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE redeemed_at IS NULL AND revoked_at IS NULL)::int AS unused,
      COUNT(*) FILTER(WHERE redeemed_at IS NOT NULL)::int AS redeemed,
      COUNT(*) FILTER(WHERE revoked_at IS NOT NULL)::int AS revoked
      FROM blofy_xtream_gateway_duration_codes`);
    return {ok:true,items:result.rows.map(safeCodeRecord),totals:totals.rows[0],
      nextOffset:result.rows.length===n?start+n:null};
  }
  async function revoke(id){
    if(!UUID.test(String(id||'')))throw Object.assign(Error('stream_code_invalid'),{status:400});
    const result=await pool.query(`UPDATE blofy_xtream_gateway_duration_codes
      SET revoked_at=NOW() WHERE id=$1 AND redeemed_at IS NULL AND revoked_at IS NULL
      RETURNING *`,[id]);
    if(!result.rows.length)
      throw Object.assign(Error('stream_code_used_or_missing'),{status:409});
    return {ok:true,item:safeCodeRecord(result.rows[0])};
  }
  async function redeem(value,host){
    const proof=streamCodeProof(value,keyHex);
    if(!proof)throw Object.assign(Error('stream_code_invalid'),{status:400});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // Row lock makes simultaneous redemption across Railway instances safe.
      const row=(await client.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
        WHERE code_hash=$1 FOR UPDATE`,[proof])).rows[0];
      if(!row||row.revoked_at||row.redeemed_at)
        throw Object.assign(Error('stream_code_unavailable'),{status:409});
      await checkedSource(client,row.source_id);
      const redeemedAt=new Date(clock());
      const expiresAt=new Date(redeemedAt.getTime()+Number(row.duration_days)*86400000);
      if(!Number.isFinite(expiresAt.getTime()))
        throw Object.assign(Error('stream_code_expiry_invalid'),{status:400});
      const username=generateGatewayUsername(randomBytes);
      const password=generateGatewayPassword(randomBytes);
      const accountId=uuid();
      const credentialProof=gatewayCredentialProof(username,password,keyHex);
      await client.query(`INSERT INTO blofy_xtream_gateway_accounts
        (id,label,username,password_proof,enabled,max_connections,expires_at,source_id)
        VALUES($1,$2,$3,$4,TRUE,$5,$6,$7)`,[
        accountId,row.label,username,credentialProof,
        Number(row.max_connections),expiresAt,row.source_id
      ]);
      await client.query(`UPDATE blofy_xtream_gateway_duration_codes
        SET redeemed_at=$2,expires_at=$3,account_id=$4 WHERE id=$1`,
        [row.id,redeemedAt,expiresAt,accountId]);
      await client.query('COMMIT');
      const serverUrl=host==='https://blofyplayer.com'?'https://blofyplayer.com':host;
      const params=new URLSearchParams({
        username,password,type:'m3u_plus',output:'ts'
      });
      return {ok:true,account:{id:accountId,label:row.label,
          sourceId:row.source_id||null,expiresAt:expiresAt.getTime(),
          activatedAt:redeemedAt.getTime(),durationDays:Number(row.duration_days)},
        credentials:{serverUrl,username,password,
          m3uUrl:serverUrl+'/get.php?'+params.toString()}};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
  }
  return {issue,list,revoke,redeem};
}

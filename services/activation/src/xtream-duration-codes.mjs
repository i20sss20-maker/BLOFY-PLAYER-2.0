// BLOFY STREAM subscriptions: duration begins ONLY at first successful
// redemption. New codes are numeric and grow gradually with issuance volume;
// all codes are stored as HMAC proofs, and existing 24-hex codes remain valid.
// redeemed twice. Passwords for resulting Xtream accounts remain one-way
// proofs; new credentials are shown once to the redeemer, never in lists.
import crypto from 'node:crypto';
import {gatewayCredentialProof,generateGatewayUsername,
  generateGatewayPassword} from './xtream-gateway-core.mjs';
import {encryptGatewayAccountPassword,decryptGatewayAccountPassword} from './xtream-account-vault.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_DAYS=730;
export function normalizeStreamCode(value){
  // Accept Arabic-Indic keyboards and preserve any pre-existing 24-hex codes.
  const code=String(value||'').trim().toUpperCase()
    .replace(/[٠-٩]/g,char=>String(char.charCodeAt(0)-0x660))
    .replace(/[۰-۹]/g,char=>String(char.charCodeAt(0)-0x6f0))
    .replace(/[\s-]+/g,'');
  return /^(?:[0-9]{8,12}|[A-F0-9]{24})$/.test(code)?code:null;
}
// Start short, grow automatically when the number of issued codes grows;
// issuance count includes redeemed/revoked codes so length never shrinks.
export function streamNumericCodeLength(totalIssued){
  const n=Math.max(0,Number(totalIssued)||0);
  if(n<100)return 8;
  if(n<1000)return 9;
  if(n<10000)return 10;
  if(n<100000)return 11;
  return 12;
}
export function randomNumericStreamCode(length,randomBytes=crypto.randomBytes){
  if(!Number.isInteger(length)||length<8||length>12)throw Error('stream_code_length_invalid');
  let out='';
  // Rejection sampling eliminates modulo bias (0..249 is divisible by 10).
  for(let attempts=0;out.length<length&&attempts<12;attempts++){
    for(const byte of randomBytes(length*2)){
      if(byte<250){out+=String(byte%10);if(out.length===length)break;}
    }
  }
  if(out.length!==length)throw Error('stream_code_random_unavailable');
  return out;
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
    redeemed_device_hash TEXT,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CHECK (redeemed_at IS NULL OR (account_id IS NOT NULL AND expires_at IS NOT NULL)),
    CHECK (NOT (revoked_at IS NOT NULL AND redeemed_at IS NOT NULL))
  )`);
  await client.query('ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS redeemed_device_hash TEXT');
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
      // Serialize code batches across instances so digit-length thresholds
      // follow actual issuance volume, not a potentially stale counter.
      await client.query('SELECT pg_advisory_xact_lock(718420682)');
      const countRow=(await client.query(
        'SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_duration_codes'
      )).rows[0];
      let issued=Number(countRow?.count)||0;
      for(let i=0;i<opts.quantity;i++){
        let inserted=false;
        for(let attempt=0;attempt<12;attempt++){
          const code=randomNumericStreamCode(streamNumericCodeLength(issued),randomBytes);
          const hash=streamCodeProof(code,keyHex),id=uuid();
          const result=await client.query(`INSERT INTO blofy_xtream_gateway_duration_codes
            (id,code_hash,code_hint,label,source_id,duration_days,max_connections)
            VALUES($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (code_hash) DO NOTHING RETURNING *`,[
            id,hash,code.slice(0,2)+'••••'+code.slice(-2),opts.label,
            opts.sourceId,opts.durationDays,opts.maxConnections
          ]);
          if(!result.rows?.length)continue;
          items.push({...safeCodeRecord(result.rows[0]),code});
          issued++;inserted=true;break;
        }
        if(!inserted)throw Object.assign(Error('stream_code_generation_unavailable'),{status:503});
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
  // An installation-local high-entropy token makes a lost HTTP response
  // retryable by that same installation without moving a redeemed code.
  function makeResponse({host,row,username,password,accountId,activatedAt,expiresAt,recovered=false}){
    const serverUrl=host==='https://blofyplayer.com'?'https://blofyplayer.com':host;
    const params=new URLSearchParams({username,password,type:'m3u_plus',output:'ts'});
    return {ok:true,recovered,account:{id:accountId,label:row.label,
      sourceId:row.source_id||null,expiresAt:expiresAt.getTime(),
      activatedAt:activatedAt.getTime(),durationDays:Number(row.duration_days)},
      credentials:{serverUrl,username,password,
        m3uUrl:serverUrl+'/get.php?'+params.toString()}};
  }
  async function redeem(value,host,{deviceKey=null}={}){
    const proof=streamCodeProof(value,keyHex);
    if(!proof)throw Object.assign(Error('stream_code_invalid'),{status:400});
    if(deviceKey!==null&&!/^[0-9a-f]{64}$/i.test(String(deviceKey)))
      throw Object.assign(Error('stream_code_device_invalid'),{status:400});
    const deviceProof=deviceKey?crypto.createHmac('sha256',Buffer.from(keyHex,'hex'))
      .update('blofy-stream-activation-device:v1:').update(String(deviceKey).toLowerCase())
      .digest('hex'):null;
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // Row lock makes simultaneous redemption across Railway instances safe.
      const row=(await client.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
        WHERE code_hash=$1 FOR UPDATE`,[proof])).rows[0];
      if(!row||row.revoked_at)
        throw Object.assign(Error('stream_code_unavailable'),{status:409});
      // Existing activation is immutable. Only the same installation
      // can retrieve its already-issued credentials after an interrupted
      // first response. Web redemptions without device binding stay single-use.
      if(row.redeemed_at){
        if(!deviceProof||row.redeemed_device_hash!==deviceProof)
          throw Object.assign(Error('stream_code_unavailable'),{status:409});
        const existing=(await client.query(`SELECT id,username,credential_vault,enabled,expires_at
          FROM blofy_xtream_gateway_accounts WHERE id=$1`,[row.account_id])).rows[0];
        const password=existing?decryptGatewayAccountPassword(existing.id,
          existing.credential_vault,keyHex):null;
        if(!existing||!password||!existing.enabled||
           new Date(existing.expires_at).getTime()<=clock())
          throw Object.assign(Error('stream_code_unavailable'),{status:409});
        await client.query('COMMIT');
        return makeResponse({host,row,username:existing.username,password,
          accountId:existing.id,activatedAt:new Date(row.redeemed_at),
          expiresAt:new Date(row.expires_at),recovered:true});
      }
      await checkedSource(client,row.source_id);
      const redeemedAt=new Date(clock());
      const expiresAt=new Date(redeemedAt.getTime()+Number(row.duration_days)*86400000);
      if(!Number.isFinite(expiresAt.getTime()))
        throw Object.assign(Error('stream_code_expiry_invalid'),{status:400});
      const username=generateGatewayUsername(randomBytes);
      const password=generateGatewayPassword(randomBytes);
      const accountId=uuid();
      const credentialProof=gatewayCredentialProof(username,password,keyHex);
      const vault=encryptGatewayAccountPassword(accountId,password,keyHex);
      await client.query(`INSERT INTO blofy_xtream_gateway_accounts
        (id,label,username,password_proof,enabled,max_connections,expires_at,source_id,credential_vault)
        VALUES($1,$2,$3,$4,TRUE,$5,$6,$7,$8)`,[
        accountId,row.label,username,credentialProof,
        Number(row.max_connections),expiresAt,row.source_id,vault
      ]);
      await client.query(`UPDATE blofy_xtream_gateway_duration_codes
        SET redeemed_at=$2,expires_at=$3,account_id=$4,redeemed_device_hash=$5 WHERE id=$1`,
        [row.id,redeemedAt,expiresAt,accountId,deviceProof]);
      await client.query('COMMIT');
      return makeResponse({host,row,username,password,accountId,activatedAt:redeemedAt,expiresAt});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
  }
  return {issue,list,revoke,redeem};
}

// BLOFY STREAM subscriptions: duration begins ONLY at first successful
// redemption. New codes are numeric and grow gradually with issuance volume;
// all codes are stored as HMAC proofs, and existing 24-hex codes remain valid.
// redeemed twice. Passwords for resulting Xtream accounts remain one-way
// proofs; new credentials are shown once to the redeemer, never in lists.
import crypto from 'node:crypto';
import {gatewayCredentialProof,generateGatewayUsername,
  generateGatewayPassword} from './xtream-gateway-core.mjs';
import {encryptGatewayAccountPassword,decryptGatewayAccountPassword} from './xtream-account-vault.mjs';
import {createStreamAppToken} from './xtream-code-app-token.mjs';
import {encryptStreamCode,decryptStreamCode} from './xtream-code-vault.mjs';
import {streamDeviceProof,hasApprovedRelogin} from './xtream-code-device-binding.mjs';

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
  const channel=String(data.channel??'xtream').trim().toLowerCase();
  if(!['app','xtream'].includes(channel))
    throw Object.assign(Error('stream_code_channel_invalid'),{status:400});
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
  return {durationDays,quantity,maxConnections,sourceId,label,channel};
}
export function safeCodeRecord(row){
  return {
    id:row.id,label:String(row.label||'').slice(0,100),
    channel:row.code_channel||'xtream',
    sourceId:row.source_id||null,durationDays:Number(row.duration_days),
    maxConnections:Number(row.max_connections),
    status:row.revoked_at?'revoked':row.redeemed_at?'redeemed':'unused',
    createdAt:row.created_at?new Date(row.created_at).getTime():null,
    redeemedAt:row.redeemed_at?new Date(row.redeemed_at).getTime():null,
    expiresAt:row.expires_at?new Date(row.expires_at).getTime():null,
    accountId:row.account_id||null,codeHint:row.code_hint||'',
    copyAvailable:Boolean(row.code_vault),
    buyerName:String(row.buyer_name||'').slice(0,80),
    buyerPhone:String(row.buyer_phone||'').slice(0,22),
    salePriceHalalas:row.sale_price_halalas==null?null:Number(row.sale_price_halalas),
    soldAt:row.sold_at?new Date(row.sold_at).getTime():null,
    salesChannel:String(row.sales_channel||'').slice(0,24),
    transferCount:Number(row.transfer_count||0),
    adminReloginCount:Number(row.admin_relogin_count||0),
    adminReloginUntil:row.admin_relogin_until?new Date(row.admin_relogin_until).getTime():null,
    extendedDays:Number(row.extended_days||0),
    deviceTransferPending:row.code_channel==='app'&&Boolean(row.redeemed_at)&&!row.redeemed_device_hash,
    xtreamRecoveryPending:row.code_channel==='xtream'&&Boolean(row.xtream_recovery_until)&&
      new Date(row.xtream_recovery_until).getTime()>Date.now()
  };
}
export async function ensureStreamCodeTable(client){
  await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_duration_codes (
    id UUID PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    code_channel TEXT NOT NULL DEFAULT 'xtream' CHECK(code_channel IN ('xtream','app')),
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
  await client.query('ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS code_vault TEXT');
  // One-time operator-authorized credential recovery for consumed Xtream vouchers.
  // Never resets redeemed_at or subscription expiry.
  await client.query('ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS xtream_recovery_until TIMESTAMPTZ');
  await client.query("ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS code_channel TEXT NOT NULL DEFAULT 'xtream'");
  await client.query(`CREATE INDEX IF NOT EXISTS idx_blofy_stream_codes_created
    ON blofy_xtream_gateway_duration_codes(created_at DESC)`);
}
// Applies ONLY to newly issued codes when the owner opts into the saleh
// policy. Redeemed codes, existing accounts and provider credentials stay
// untouched. No external Xtream request is made by this check.
export async function assertSalehNewCodeSource(db,sourceId){
 if(!sourceId)throw Object.assign(Error('stream_saleh_source_required'),{status:409});
 const result=await db.query(`SELECT id,name FROM blofy_xtream_servers
   WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
     AND deletion_requested_at IS NULL LIMIT 1`,[sourceId]);
 const row=result.rows?.[0];
 if(!row||String(row.name||'').trim().toLowerCase()!=='saleh')
   throw Object.assign(Error('stream_saleh_only_new_codes'),{status:409});
 const all=await db.query(`SELECT COUNT(*)::int AS total FROM blofy_xtream_servers
   WHERE lower(btrim(name))='saleh' AND deletion_requested_at IS NULL`);
 if(Number(all.rows?.[0]?.total)!==1)
   throw Object.assign(Error('stream_saleh_source_not_unique'),{status:409});
 return true;
}

export function createStreamDurationCodes({pool,keyHex,clock=Date.now,
  randomBytes=crypto.randomBytes,uuid=crypto.randomUUID,
  salehOnlyNewCodes=false}={}){
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
      if(salehOnlyNewCodes===true)
        await assertSalehNewCodeSource(client,opts.sourceId);
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
            (id,code_hash,code_hint,label,source_id,duration_days,max_connections,code_channel,code_vault)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (code_hash) DO NOTHING RETURNING *`,[
            id,hash,code.slice(0,2)+'••••'+code.slice(-2),opts.label,
            opts.sourceId,opts.durationDays,opts.maxConnections,opts.channel,
            encryptStreamCode(id,code,keyHex)
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
  // Operator-only *read* of a voucher by its HMAC proof. Unlike redemption,
  // this never consumes a code, resets a clock, or exposes account credentials.
  // The caller MUST be guarded by the existing admin session.
  async function lookup(value){
    const proof=streamCodeProof(value,keyHex);
    if(!proof)throw Object.assign(Error('stream_code_invalid'),{status:400});
    const result=await pool.query(`SELECT c.*,
        a.enabled AS linked_account_enabled,
        a.expires_at AS linked_account_expires_at,
        (a.id IS NOT NULL) AS linked_account_exists
      FROM blofy_xtream_gateway_duration_codes c
      LEFT JOIN blofy_xtream_gateway_accounts a ON a.id=c.account_id
      WHERE c.code_hash=$1 LIMIT 1`,[proof]);
    const row=result.rows?.[0];
    if(!row)return {ok:false,code:'stream_code_not_found'};
    const info=safeCodeRecord(row);
    const now=clock();
    const validDate=value=>{
      if(!value)return null;
      const ms=new Date(value).getTime();
      return Number.isFinite(ms)?ms:null;
    };
    const accountExpiry=validDate(row.linked_account_expires_at);
    const codeExpiry=validDate(row.expires_at);
    const effectiveExpiry=codeExpiry==null?accountExpiry:
      accountExpiry==null?codeExpiry:Math.min(codeExpiry,accountExpiry);
    const redeemed=Boolean(row.redeemed_at);
    const accountExists=Boolean(row.linked_account_exists);
    const active=redeemed&&!row.revoked_at&&accountExists&&
      row.linked_account_enabled===true&&effectiveExpiry!==null&&effectiveExpiry>now;
    return {ok:true,item:info,
      subscription:{
        redeemed,active,expired:redeemed&&effectiveExpiry!==null&&effectiveExpiry<=now,
        accountExists,accountEnabled:accountExists?row.linked_account_enabled===true:false,
        expiresAt:effectiveExpiry,
        canExtend:redeemed&&!row.revoked_at&&accountExists,
        // App re-login requires a separate 6-digit challenge from the new device.
        requiresDeviceApproval:redeemed&&info.channel==='app'
      }
    };
  }
  async function reveal(id){
    if(!UUID.test(String(id||'')))
      throw Object.assign(Error('stream_code_invalid'),{status:400});
    const item=(await pool.query(`SELECT id,code_hash,code_vault,code_channel,revoked_at
      FROM blofy_xtream_gateway_duration_codes WHERE id=$1 LIMIT 1`,[id])).rows[0];
    if(!item)return {ok:false,code:'stream_code_not_found'};
    if(!item.code_vault)return {ok:false,code:'stream_code_legacy_unrecoverable'};
    if(item.revoked_at)return {ok:false,code:'stream_code_revoked'};
    const code=decryptStreamCode(id,item.code_vault,keyHex);
    if(!code||streamCodeProof(code,keyHex)!==item.code_hash)
      return {ok:false,code:'stream_code_vault_integrity_failed'};
    return {ok:true,code,id:item.id,channel:item.code_channel};
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
  function makeResponse({host,row,username,password,accountId,activatedAt,expiresAt,recovered=false,appOnly=false,deviceProof=null}){
    if(appOnly){
      if(!deviceProof)throw Object.assign(Error('stream_code_device_required'),{status:400});
      const token=createStreamAppToken({
        account_id:accountId,code_hash:row.code_hash,
        redeemed_device_hash:deviceProof
      },keyHex);
      return {ok:true,recovered,accessToken:token,tokenType:'Bearer',
        account:{id:accountId,activatedAt:activatedAt.getTime(),
          expiresAt:expiresAt.getTime(),durationDays:Number(row.duration_days)}};
    }
    const serverUrl=host==='https://blofyplayer.com'?'https://blofyplayer.com':host;
    const params=new URLSearchParams({username,password,type:'m3u_plus',output:'ts'});
    return {ok:true,recovered,account:{id:accountId,label:row.label,
      sourceId:row.source_id||null,expiresAt:expiresAt.getTime(),
      activatedAt:activatedAt.getTime(),durationDays:Number(row.duration_days)},
      credentials:{serverUrl,username,password,
        m3uUrl:serverUrl+'/get.php?'+params.toString()}};
  }
  async function redeem(value,host,{deviceKey=null,appOnly=false}={}){
    if(appOnly&&!deviceKey)
      throw Object.assign(Error('stream_code_device_required'),{status:400});
    const proof=streamCodeProof(value,keyHex);
    if(!proof)throw Object.assign(Error('stream_code_invalid'),{status:400});
    if(deviceKey!==null&&!/^[0-9a-f]{64}$/i.test(String(deviceKey)))
      throw Object.assign(Error('stream_code_device_invalid'),{status:400});
    const deviceProof=deviceKey?streamDeviceProof(deviceKey,keyHex):null;
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // Row lock makes simultaneous redemption across Railway instances safe.
      const row=(await client.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
        WHERE code_hash=$1 FOR UPDATE`,[proof])).rows[0];
      if(!row||row.revoked_at)
        throw Object.assign(Error('stream_code_unavailable'),{status:409});
      // Compatibility with freshly issued BLOFY STREAM numeric vouchers
      // minted from an older/cached operator screen without an app channel.
      // The code is not consumed at issuance. A first app redemption may
      // safely claim an *unsold, never-used* STREAM-labelled numeric voucher.
      // Do not convert old hexadecimal codes, pre-app vouchers, sold Xtream
      // products, revoked codes, or any existing subscription.
      if(appOnly && (row.code_channel||'xtream')==='xtream' &&
         !row.redeemed_at && !row.sold_at &&
         String(row.label||'').trim().toUpperCase()==='BLOFY STREAM' &&
         /^[0-9]{8,12}$/.test(normalizeStreamCode(value)||'') &&
         new Date(row.created_at).getTime()>=Date.parse('2026-11-09T00:00:00Z')){
        const converted=(await client.query(`UPDATE blofy_xtream_gateway_duration_codes
          SET code_channel='app'
          WHERE id=$1 AND code_channel='xtream' AND redeemed_at IS NULL
            AND revoked_at IS NULL AND sold_at IS NULL
          RETURNING code_channel`,[row.id])).rows[0];
        if(converted?.code_channel==='app')row.code_channel='app';
      }
      if((row.code_channel||'xtream')!==(appOnly?'app':'xtream'))
        throw Object.assign(Error('stream_code_wrong_product'),{status:409});
      // Existing activation is immutable. Only the same installation
      // can retrieve its already-issued credentials after an interrupted
      // first response. Web redemptions without device binding stay single-use.
      if(row.redeemed_at){
        if(!row.account_id||!row.expires_at)
          throw Object.assign(Error('stream_subscription_state_inconsistent'),{status:409});
        // The Xtream web redeem page is deliberately single-use. Only an
        // explicit administrator-issued replacement voucher permits ONE
        // recovery of the same existing account, within a 24-hour window.
        // Old vouchers are invalidated at issuance and no new account or
        // subscription time can be created by this recovery path.
        if(!deviceProof && row.code_channel==='xtream' &&
           row.xtream_recovery_until &&
           new Date(row.xtream_recovery_until).getTime()>clock()){
          const existing=(await client.query(`SELECT id,username,credential_vault,enabled,expires_at
            FROM blofy_xtream_gateway_accounts WHERE id=$1 FOR UPDATE`,
            [row.account_id])).rows[0];
          const password=existing?decryptGatewayAccountPassword(existing.id,
            existing.credential_vault,keyHex):null;
          const codeExpiry=new Date(row.expires_at).getTime();
          const accountExpiry=new Date(existing?.expires_at).getTime();
          if(!existing||!password||!existing.enabled||
             !Number.isFinite(codeExpiry)||!Number.isFinite(accountExpiry)||
             Math.min(codeExpiry,accountExpiry)<=clock())
            throw Object.assign(Error('stream_code_unavailable'),{status:409});
          const consumed=await client.query(`UPDATE blofy_xtream_gateway_duration_codes
            SET xtream_recovery_until=NULL WHERE id=$1
              AND xtream_recovery_until>NOW() RETURNING id`,[row.id]);
          if(consumed.rowCount!==1)
            throw Object.assign(Error('stream_code_unavailable'),{status:409});
          await client.query('COMMIT');
          return makeResponse({host,row,username:existing.username,password,
            accountId:existing.id,activatedAt:new Date(row.redeemed_at),
            expiresAt:new Date(Math.min(codeExpiry,accountExpiry)),recovered:true});
        }
        if(!deviceProof)throw Object.assign(Error('stream_code_unavailable'),{status:409});
        // An operator reissues a new recovery code for an existing subscription
        // and clears the old binding. Its original clock and expiry do not reset.
        const transferPending=appOnly&&row.code_channel==='app'&&
          !row.redeemed_device_hash;
        // A normal logout on the original installation already succeeds.
        // New installations can reuse the SAME voucher only after admin
        // approval of the 6-digit request originating from that installation.
        const reloginApproved=appOnly&&hasApprovedRelogin(row,deviceProof,clock());
        // The administrator can also open a short one-time window for the
        // original code without knowing the new device identifier. The FIRST
        // different installation that redeems within 10 minutes claims it.
        const adminReloginApproved=appOnly&&row.code_channel==='app'&&
          row.redeemed_device_hash&&row.redeemed_device_hash!==deviceProof&&
          row.admin_relogin_until&&
          new Date(row.admin_relogin_until).getTime()>clock();
        if(!transferPending&&!reloginApproved&&!adminReloginApproved&&
           row.redeemed_device_hash!==deviceProof)
          throw Object.assign(Error('stream_code_unavailable'),{status:409});
        if(adminReloginApproved){
          // Rotate the binding once, atomically. Existing signed app tokens
          // are bound to the OLD device proof and fail immediately afterward.
          // The voucher hash, account, redeemed_at and expiry never change.
          const claimed=await client.query(`UPDATE blofy_xtream_gateway_duration_codes
            SET redeemed_device_hash=$2,admin_relogin_until=NULL,
                admin_relogin_count=admin_relogin_count+1,
                relogin_device_hash=NULL,relogin_request_hash=NULL,
                relogin_requested_at=NULL,relogin_approved_at=NULL,
                relogin_expires_at=NULL
            WHERE id=$1 AND redeemed_device_hash IS NOT NULL AND
              redeemed_device_hash<>$2 AND admin_relogin_until>$3
            RETURNING id`,[row.id,deviceProof,new Date(clock())]);
          if(claimed.rowCount!==1)
            throw Object.assign(Error('stream_code_relogin_approval_expired'),{status:409});
          row.redeemed_device_hash=deviceProof;
          await client.query(`INSERT INTO blofy_xtream_gateway_code_events
            (id,code_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)`,
            [uuid(),row.id,'same_code_admin_relogin_used',
              JSON.stringify({oneTime:true,subscriptionUnchanged:true})]);
        }else if(reloginApproved){
          // Atomic one-time binding rotation; prior bearer stops verifying
          // immediately. The original subscription clock/expiry is unchanged.
          const rebound=await client.query(`UPDATE blofy_xtream_gateway_duration_codes
            SET redeemed_device_hash=$2,
                relogin_device_hash=NULL,relogin_request_hash=NULL,
                relogin_requested_at=NULL,relogin_approved_at=NULL,
                relogin_expires_at=NULL,transfer_count=transfer_count+1,
                last_transfer_at=NOW()
            WHERE id=$1 AND relogin_device_hash=$2
              AND relogin_approved_at IS NOT NULL AND relogin_expires_at>NOW()`,
            [row.id,deviceProof]);
          if(rebound.rowCount!==1)
            throw Object.assign(Error('stream_code_relogin_approval_expired'),{status:409});
          row.redeemed_device_hash=deviceProof;
        } else if(transferPending){
          await client.query(`UPDATE blofy_xtream_gateway_duration_codes
            SET redeemed_device_hash=$2 WHERE id=$1 AND redeemed_device_hash IS NULL`,
            [row.id,deviceProof]);
        }
        const existing=(await client.query(`SELECT id,username,credential_vault,enabled,expires_at
          FROM blofy_xtream_gateway_accounts WHERE id=$1`,[row.account_id])).rows[0];
        const password=existing?decryptGatewayAccountPassword(existing.id,
          existing.credential_vault,keyHex):null;
        // The voucher is the billing source of truth: re-login can NEVER add
        // 365 days, even if a different account write mistakenly increased the
        // account expiry. Honor whichever persisted deadline is earlier.
        const codeExpiry=new Date(row.expires_at).getTime();
        const accountExpiry=new Date(existing?.expires_at).getTime();
        if(!existing||!password||!existing.enabled||
           !Number.isFinite(codeExpiry)||!Number.isFinite(accountExpiry)||
           Math.min(codeExpiry,accountExpiry)<=clock())
          throw Object.assign(Error('stream_code_unavailable'),{status:409});
        await client.query('COMMIT');
        return makeResponse({host,row,username:existing.username,password,
          accountId:existing.id,activatedAt:new Date(row.redeemed_at),
          expiresAt:new Date(Math.min(codeExpiry,accountExpiry)),
          recovered:true,appOnly,deviceProof});
      }
      // A voucher may start its clock exactly ONCE. Even if a legacy or
      // partially failed transfer cleared redeemed_at, other persisted
      // activation markers must block new-year issuance, not start over.
      // New subscriptions require a separately issued *new* voucher.
      if(row.account_id||row.expires_at||row.redeemed_device_hash||
         Number(row.transfer_count||0)>0||Number(row.extended_days||0)>0)
        throw Object.assign(Error('stream_subscription_already_started'),{status:409});
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
      const claimed=await client.query(`UPDATE blofy_xtream_gateway_duration_codes
        SET redeemed_at=$2,expires_at=$3,account_id=$4,redeemed_device_hash=$5
        WHERE id=$1 AND redeemed_at IS NULL AND account_id IS NULL
          AND expires_at IS NULL AND revoked_at IS NULL
        RETURNING id`,
        [row.id,redeemedAt,expiresAt,accountId,deviceProof]);
      if(!claimed.rows?.[0])
        throw Object.assign(Error('stream_subscription_already_started'),{status:409});
      await client.query('COMMIT');
      return makeResponse({host,row,username,password,accountId,activatedAt:redeemedAt,expiresAt,appOnly,deviceProof});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
  }
  return {issue,list,lookup,reveal,revoke,redeem};
}

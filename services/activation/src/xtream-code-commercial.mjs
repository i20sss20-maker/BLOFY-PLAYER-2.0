// Admin-only commercial lifecycle for BLOFY STREAM code subscriptions.
// None of these endpoints are public. Device moves preserve activation time
// and expiry; the previous bearer becomes invalid immediately after reissue.
import crypto from 'node:crypto';
import {randomNumericStreamCode,streamNumericCodeLength,streamCodeProof,safeCodeRecord}
  from './xtream-duration-codes.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function problem(message,status=400){
  return Object.assign(new Error(message),{status});
}
function validId(id){
  if(!UUID.test(String(id||'')))throw problem('stream_code_id_invalid');
  return String(id);
}
function scrub(value,length){
  return String(value||'').trim().replace(/[\x00-\x1f\x7f]/g,' ').slice(0,length);
}
export function validSaleData(data={}){
  const number=Number(data.priceSar);
  if(!Number.isFinite(number)||number<0||number>100000||
    Math.abs(Math.round(number*100)/100-number)>0.0000001)
    throw problem('stream_sale_price_invalid');
  const priceHalalas=Math.round(number*100);
  const buyerName=scrub(data.buyerName,80);
  const buyerPhone=scrub(data.buyerPhone,22);
  if(buyerPhone&&!/^\+?[0-9]{7,15}$/.test(buyerPhone))
    throw problem('stream_sale_phone_invalid');
  const channel=scrub(data.channel||'manual',24);
  if(!/^[A-Za-z0-9_-]{1,24}$/.test(channel))
    throw problem('stream_sale_channel_invalid');
  return {priceHalalas,buyerName,buyerPhone,channel};
}
export function validExtension(data={}){
  const days=Number(data.days);
  if(!Number.isSafeInteger(days)||days<1||days>730)
    throw problem('stream_extension_days_invalid');
  return days;
}
export async function ensureStreamCommercialSchema(pool){
  for(const ddl of [
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS buyer_name TEXT',
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS buyer_phone TEXT',
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS sale_price_halalas INTEGER',
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ',
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS sales_channel TEXT',
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS transfer_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS last_transfer_at TIMESTAMPTZ',
    'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS extended_days INTEGER NOT NULL DEFAULT 0'
  ])await pool.query(ddl);
  await pool.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_code_events(
    id UUID PRIMARY KEY, code_id UUID NOT NULL REFERENCES blofy_xtream_gateway_duration_codes(id),
    event_type TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_blofy_xtream_code_events_created
    ON blofy_xtream_gateway_code_events(occurred_at DESC)`);
}
export function createStreamCommercial({pool,keyHex,clock=Date.now,
  randomBytes=crypto.randomBytes,uuid=crypto.randomUUID}={}){
  if(!pool||!/^[0-9a-f]{64}$/i.test(String(keyHex||'')))
    throw Error('stream_commercial_storage_not_ready');
  const run=async(task)=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const result=await task(client);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
  };
  async function event(client,codeId,eventType,details={}){
    await client.query(`INSERT INTO blofy_xtream_gateway_code_events
      (id,code_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)`,
      [uuid(),codeId,eventType,JSON.stringify(details)]);
  }
  async function markSold(id,data){
    validId(id);const sale=validSaleData(data);
    return run(async db=>{
      const row=(await db.query(`UPDATE blofy_xtream_gateway_duration_codes
        SET buyer_name=$2,buyer_phone=$3,sale_price_halalas=$4,
            sales_channel=$5,sold_at=NOW()
        WHERE id=$1 AND revoked_at IS NULL AND sold_at IS NULL
        RETURNING *`,[id,sale.buyerName,sale.buyerPhone,
          sale.priceHalalas,sale.channel])).rows[0];
      if(!row)throw problem('stream_sale_already_recorded_or_missing',409);
      await event(db,id,'sale_recorded',
        {priceHalalas:sale.priceHalalas,channel:sale.channel});
      return {ok:true,item:safeCodeRecord(row)};
    });
  }
  async function extend(id,data){
    validId(id);const days=validExtension(data);
    return run(async db=>{
      const code=(await db.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
        WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(!code||!code.redeemed_at||!code.account_id||code.revoked_at)
        throw problem('stream_extension_unavailable',409);
      const account=(await db.query(`SELECT id,expires_at FROM blofy_xtream_gateway_accounts
        WHERE id=$1 FOR UPDATE`,[code.account_id])).rows[0];
      if(!account)throw problem('stream_subscription_missing',409);
      const baseline=Math.max(clock(),
        new Date(code.expires_at).getTime(),new Date(account.expires_at).getTime());
      const next=new Date(baseline+days*86400000);
      if(!Number.isFinite(next.getTime()))throw problem('stream_extension_invalid',409);
      await db.query(`UPDATE blofy_xtream_gateway_accounts
        SET expires_at=$2,updated_at=NOW() WHERE id=$1`,[code.account_id,next]);
      const row=(await db.query(`UPDATE blofy_xtream_gateway_duration_codes
        SET expires_at=$2,extended_days=extended_days+$3 WHERE id=$1 RETURNING *`,
        [id,next,days])).rows[0];
      await event(db,id,'extended',{days,expiresAt:next.toISOString()});
      return {ok:true,item:safeCodeRecord(row)};
    });
  }
  async function reissueForDeviceTransfer(id){
    validId(id);
    return run(async db=>{
      // Same lock as bulk issuance prevents concurrent numeric collisions.
      await db.query('SELECT pg_advisory_xact_lock(718420682)');
      const row=(await db.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
        WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(!row||row.code_channel!=='app'||!row.redeemed_at||!row.account_id||
        row.revoked_at||!row.redeemed_device_hash||
        new Date(row.expires_at).getTime()<=clock())
        throw problem('stream_transfer_unavailable',409);
      const account=(await db.query(`SELECT enabled,expires_at
        FROM blofy_xtream_gateway_accounts WHERE id=$1 FOR UPDATE`,
        [row.account_id])).rows[0];
      if(!account||!account.enabled||new Date(account.expires_at).getTime()<=clock())
        throw problem('stream_transfer_unavailable',409);
      const total=Number((await db.query(
        'SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_duration_codes'
      )).rows[0]?.count)||0;
      const length=streamNumericCodeLength(total);
      for(let attempt=0;attempt<12;attempt++){
        const code=randomNumericStreamCode(length,randomBytes);
        const hash=streamCodeProof(code,keyHex);
        const exists=(await db.query(`SELECT 1 FROM blofy_xtream_gateway_duration_codes
          WHERE code_hash=$1 LIMIT 1`,[hash])).rows.length>0;
        if(exists)continue;
        const updated=(await db.query(`UPDATE blofy_xtream_gateway_duration_codes
          SET code_hash=$2,code_hint=$3,redeemed_device_hash=NULL,
              transfer_count=transfer_count+1,last_transfer_at=NOW()
          WHERE id=$1 RETURNING *`,[id,hash,code.slice(0,2)+'••••'+code.slice(-2)])).rows[0];
        await event(db,id,'device_transfer_code_reissued',
          {transferCount:Number(updated.transfer_count)});
        // The old HMAC bearer is invalidated by the changed code_hash.
        return {ok:true,item:safeCodeRecord(updated),code,
          expiresAt:new Date(updated.expires_at).getTime(),
          durationUnchanged:true};
      }
      throw problem('stream_transfer_code_generation_unavailable',503);
    });
  }
  async function salesSummary(){
    const r=await pool.query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE code_channel='app')::int AS app_codes,
      COUNT(*) FILTER(WHERE redeemed_at IS NULL AND revoked_at IS NULL)::int AS unused,
      COUNT(*) FILTER(WHERE redeemed_at IS NOT NULL)::int AS redeemed,
      COUNT(*) FILTER(WHERE sold_at IS NOT NULL)::int AS sold,
      COALESCE(SUM(sale_price_halalas) FILTER(WHERE sold_at IS NOT NULL),0)::bigint
        AS recorded_revenue_halalas,
      COUNT(*) FILTER(WHERE redeemed_at IS NOT NULL AND expires_at>NOW()
        AND expires_at<NOW()+INTERVAL '7 days')::int AS expiring_soon,
      COALESCE(SUM(transfer_count),0)::bigint AS transfers
      FROM blofy_xtream_gateway_duration_codes`);
    return {ok:true,currency:'SAR',...(r.rows?.[0]||{})};
  }
  return {markSold,extend,reissueForDeviceTransfer,salesSummary};
}

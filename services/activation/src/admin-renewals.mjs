import {recordAudit} from './audit.mjs';

export const RENEWAL_OPTIONS=Object.freeze([
  {key:'month',name:'شهر',months:1}, {key:'quarter',name:'3 أشهر',months:3},
  {key:'half-year',name:'6 أشهر',months:6}, {key:'year',name:'سنة',months:12},
  {key:'lifetime',name:'مدى الحياة',months:null}
]);
export class RenewalError extends Error {
  constructor(code,status=400){super(code);this.status=status;}
}
const time=value=>value==null?null:new Date(value).getTime();
const optionFor=key=>{const option=RENEWAL_OPTIONS.find(x=>x.key===key);if(!option)throw new RenewalError('invalid_duration');return option;};
export function addCalendarMonths(timestamp,months){
  const date=new Date(timestamp),day=date.getUTCDate();
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,lastDay));return date.getTime();
}
export function renewalPreview(device,duration,now=Date.now()){
  const option=optionFor(duration);
  if(!device)throw new RenewalError('device_not_found',404);
  if(device.status==='blocked')throw new RenewalError('device_blocked',409);
  const previousExpiresAt=time(device.expires_at);
  if(device.status==='active'&&previousExpiresAt===null)throw new RenewalError('already_lifetime',409);
  const startsAt=Math.max(now,Number.isFinite(previousExpiresAt)?previousExpiresAt:0);
  return {duration:option.key,name:option.name,previousExpiresAt,startsAt,
    expiresAt:option.months===null?null:addCalendarMonths(startsAt,option.months)};
}

/** Uses the existing subscription ledger; manual options are never public purchasable plans. */
export async function renewDevice(pool,{deviceId,duration,requestId,expectedExpiresAt}){
  const option=optionFor(duration),planKey='admin-manual-'+option.key;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId||'')))throw new RenewalError('invalid_request');
  if(expectedExpiresAt!==null&&(!Number.isFinite(expectedExpiresAt)||expectedExpiresAt<0))throw new RenewalError('invalid_request');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query('SELECT status,expires_at FROM devices WHERE device_id=$1 FOR UPDATE',[deviceId]);
    if(!result.rows[0])throw new RenewalError('device_not_found',404);
    const existing=await client.query('SELECT device_id,plan_key,expires_at FROM device_subscriptions WHERE id=$1',[requestId]);
    if(existing.rows[0]){
      const row=existing.rows[0];
      if(row.device_id!==deviceId||row.plan_key!==planKey)throw new RenewalError('request_conflict',409);
      await client.query('COMMIT');return {ok:true,replayed:true,expiresAt:time(row.expires_at)};
    }
    const preview=renewalPreview(result.rows[0],duration);
    if(preview.previousExpiresAt!==expectedExpiresAt)throw new RenewalError('activation_changed',409);
    // Reserved inactive plans keep foreign-key history consistent without adding free checkout products.
    await client.query(`INSERT INTO subscription_plans(plan_key,name,duration_days,price_minor,currency,active)
      VALUES($1,$2,$3,0,'SAR',FALSE) ON CONFLICT(plan_key) DO NOTHING`,
      [planKey,'تمديد إداري · '+option.name,option.months===null?null:option.months*30]);
    const expires=preview.expiresAt===null?null:new Date(preview.expiresAt);
    await client.query(`INSERT INTO device_subscriptions(id,device_id,plan_key,starts_at,expires_at,status)
      VALUES($1,$2,$3,$4,$5,'active')`,[requestId,deviceId,planKey,new Date(preview.startsAt),expires]);
    await client.query("UPDATE devices SET status='active',expires_at=$2,updated_at=NOW() WHERE device_id=$1",[deviceId,expires]);
    await recordAudit(client,deviceId,'subscription_granted',{planKey,status:'active',expiresAt:preview.expiresAt===null?'lifetime':preview.expiresAt});
    await client.query('COMMIT');return {ok:true,replayed:false,...preview};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

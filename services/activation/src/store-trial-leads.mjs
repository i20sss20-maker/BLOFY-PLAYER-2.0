/* Private store-owner trial leads: confirmed claims joined to their actual
 * verified account profile. Never infer identity from IP, hint or request time.
 * Marketing outreach is opt-in; missing legacy consent remains UNKNOWN, not yes.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_SKU=new Set(['all','trial-stream-1d','trial-xtream-1d']);
const ALLOWED_STATE=new Set(['all','unactivated','active','expired','revoked']);
export const FOLLOWUP_STATES=Object.freeze([
 'new','contacted','offer_sent','converted','do_not_contact'
]);
const FOLLOWUPS=new Set(FOLLOWUP_STATES);
const err=(message,status=400)=>Object.assign(Error(message),{status});
const hasControl=s=>/[\x00-\x1f\x7f]/.test(s);
const shorten=(value,max=200)=>String(value??'').slice(0,max);
const time=v=>v?new Date(v).toISOString():null;
export function safeTrialLead(row,now=Date.now()){
 const expiry=row.expires_at?new Date(row.expires_at).getTime():null;
 const state=row.revoked_at?'revoked':row.redeemed_at?
  (expiry!==null&&expiry<=now?'expired':'active'):'unactivated';
 return {
  voucherId:String(row.voucher_id),sku:row.sku,
  codeHint:shorten(row.code_hint,32),
  channel:row.sku==='trial-xtream-1d'?'xtream':'app',
  claimedAt:time(row.claimed_at),activatedAt:time(row.redeemed_at),
  expiresAt:time(row.expires_at),state,
  customer:{
   name:shorten(row.full_name,100),
   phone:shorten(row.phone_e164,24),
   email:shorten(row.email,254),
   // Verified account linked by trial.customer_id, not guessed from IP.
   verified:!!row.email
  },
  marketingOptIn:!!row.marketing_consent_at,
  consentAt:time(row.marketing_consent_at),
  followupStatus:FOLLOWUPS.has(row.followup_status)?
   row.followup_status:'new',
  followupNote:shorten(row.followup_note,250),
  followupUpdatedAt:time(row.followup_updated_at)
 };
}
export async function listTrialLeads(pool,body={}){
 const q=String(body?.q??'').trim(),sku=String(body?.sku??'all'),
  state=String(body?.state??'all'),offset=Number(body?.offset??0);
 if(q.length>100||q.length===1||hasControl(q)||
    !ALLOWED_SKU.has(sku)||!ALLOWED_STATE.has(state)||
    !Number.isSafeInteger(offset)||offset<0||offset>100000)
  throw err('trial_leads_filters_invalid');
 const params=[q,sku,state,offset];
 const result=await pool.query(`
  WITH leads AS (
   SELECT i.voucher_id,i.sku,i.claimed_at,i.marketing_consent_at,
    i.followup_status,i.followup_note,i.followup_updated_at,
    v.code_hint,v.redeemed_at,v.expires_at,v.revoked_at,
    c.email,c.full_name,c.phone_e164
   FROM blofy_store_trial_inventory i
   JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id
   LEFT JOIN blofy_store_customers c ON c.id=i.customer_id
   WHERE i.claimed_at IS NOT NULL AND i.customer_id IS NOT NULL
  )
  SELECT *,COUNT(*) OVER()::int AS matched FROM leads
  WHERE ($1::text='' OR
    strpos(lower(coalesce(email,'')),lower($1))>0 OR
    strpos(lower(coalesce(full_name,'')),lower($1))>0 OR
    strpos(coalesce(phone_e164,''),$1)>0 OR
    strpos(lower(coalesce(code_hint,'')),lower($1))>0 OR
    voucher_id::text=$1)
   AND ($2='all' OR sku=$2)
   AND ($3='all' OR
    ($3='revoked' AND revoked_at IS NOT NULL) OR
    ($3='unactivated' AND revoked_at IS NULL AND redeemed_at IS NULL) OR
    ($3='active' AND revoked_at IS NULL AND redeemed_at IS NOT NULL
      AND (expires_at IS NULL OR expires_at>NOW())) OR
    ($3='expired' AND revoked_at IS NULL AND redeemed_at IS NOT NULL
      AND expires_at<=NOW()))
  ORDER BY claimed_at DESC,voucher_id DESC LIMIT 25 OFFSET $4
 `,params);
 const rows=result.rows||[];
 const matched=Number(rows[0]?.matched||0);
 return {
  ok:true,items:rows.map(row=>safeTrialLead(row)),matched,
  offset,pageSize:25,nextOffset:offset+rows.length<matched?offset+rows.length:null,
  readOnly:true,includes:'verified_trial_claims_only'
 };
}
export async function updateTrialLeadFollowup(pool,body={}){
 const voucherId=String(body?.voucherId||''),
  followupStatus=String(body?.followupStatus||''),
  note=String(body?.note??'').trim();
 if(!UUID.test(voucherId)||!FOLLOWUPS.has(followupStatus)||
    note.length>250||hasControl(note))
  throw err('trial_followup_invalid');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const found=(await db.query(`SELECT voucher_id,marketing_consent_at,followup_status
    FROM blofy_store_trial_inventory
    WHERE voucher_id=$1 AND customer_id IS NOT NULL
      AND claimed_at IS NOT NULL FOR UPDATE`,[voucherId])).rows?.[0];
  if(!found)throw err('trial_lead_not_found',404);
  if(followupStatus==='offer_sent'&&!found.marketing_consent_at)
    throw err('trial_marketing_consent_required',409);
  if(found.followup_status==='do_not_contact'&&
     followupStatus!=='do_not_contact'&&followupStatus!=='new')
    throw err('trial_do_not_contact',409);
  await db.query(`UPDATE blofy_store_trial_inventory
    SET followup_status=$2,followup_note=$3,followup_updated_at=NOW()
    WHERE voucher_id=$1`,[voucherId,followupStatus,note||null]);
  // Audit without secrets, phone, email, or the freeform private note.
  await db.query(`INSERT INTO blofy_store_trial_followup_events
    (voucher_id,followup_status) VALUES($1,$2)`,[voucherId,followupStatus]);
  await db.query('COMMIT');
  return {ok:true,voucherId,followupStatus,updated:true};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
 finally{db.release()}
}

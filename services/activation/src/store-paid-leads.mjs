/* BLOFY ONE · actual paid store purchasers, verified contact profiles and
 * voluntary, revocable marketing consent. No guest identity inference, no
 * payment card/provider secrets and no mass-message sending.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CHANNELS=new Set(['all','app','xtream']);
const STATES=new Set(['all','new','contacted','offer_sent','converted','do_not_contact']);
const FOLLOWUPS=new Set(['new','contacted','offer_sent','converted','do_not_contact']);
const small=(raw,limit=200)=>String(raw??'').slice(0,limit);
const failure=(msg,status=400)=>Object.assign(new Error(msg),{status});
const time=value=>value?new Date(value).toISOString():null;
export const PAID_LEAD_STATES=Object.freeze([...FOLLOWUPS]);

export function renderPaidLead(row){
 const customer=row.customer_id?{
  id:row.customer_id,
  name:small(row.full_name,100),
  email:small(row.email,254),phone:small(row.phone_e164,24),
  verifiedEmail:Boolean(row.email)
 }:null;
 const state=FOLLOWUPS.has(row.followup_status)?row.followup_status:'new';
 return {
  orderId:row.order_id,orderNumber:small(row.public_order_number,50),
  channel:row.channel,sku:small(row.sku,80),
  amountMinor:Number(row.amount_minor),currency:'SAR',
  createdAt:time(row.created_at),paidAt:time(row.paid_at),
  recordedPaid:true,
  customer,
  marketingOptIn:Boolean(customer&&row.marketing_consent_at),
  marketingConsentAt:customer?time(row.marketing_consent_at):null,
  codeCount:Number(row.code_count)||0,
  activatedCount:Number(row.activated_count)||0,
  activatedAt:time(row.first_activated_at),
  expiresAt:time(row.last_expires_at),
  followupStatus:state,
  followupNote:small(row.followup_note,250),
  followupUpdatedAt:time(row.followup_updated_at)
 };
}
export async function preparePaidLeadSchema(pool){
 // Precondition: existing customer/order tables were prepared by their owners.
 await pool.query(`CREATE TABLE IF NOT EXISTS blofy_store_paid_followups(
  order_id UUID PRIMARY KEY REFERENCES blofy_store_geidea_orders(id) ON DELETE CASCADE,
  followup_status TEXT NOT NULL DEFAULT 'new',
  followup_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS blofy_store_paid_followup_events(
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES blofy_store_geidea_orders(id) ON DELETE CASCADE,
  followup_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
}
export async function listPaidLeads(pool,body={}){
 const q=String(body?.q??'').trim(),channel=String(body?.channel??'all'),
  followup=String(body?.followup??'all'),offset=Number(body?.offset??0);
 if(q.length>100||q.length===1||/[\x00-\x1f\x7f]/.test(q)||
  !CHANNELS.has(channel)||!STATES.has(followup)||
  !Number.isSafeInteger(offset)||offset<0||offset>100000)
  throw failure('paid_leads_filters_invalid');
 const query=`
  SELECT o.id AS order_id,o.public_order_number,o.sku,o.channel,
   o.amount_minor,o.created_at,o.paid_at,
   c.id AS customer_id,c.full_name,c.email,c.phone_e164,
   c.marketing_consent_at,
   f.followup_status,f.followup_note,f.updated_at AS followup_updated_at,
   ent.code_count,ent.activated_count,ent.first_activated_at,ent.last_expires_at,
   COUNT(*) OVER()::int AS matched
  FROM blofy_store_geidea_orders o
  LEFT JOIN blofy_store_customer_orders owner_link ON owner_link.order_id=o.id
  LEFT JOIN blofy_store_customers c ON c.id=owner_link.customer_id
  LEFT JOIN blofy_store_paid_followups f ON f.order_id=o.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS code_count,
     COUNT(*) FILTER(WHERE v.redeemed_at IS NOT NULL)::int AS activated_count,
     MIN(v.redeemed_at) AS first_activated_at,
     MAX(v.expires_at) AS last_expires_at
    FROM (
      SELECT o.voucher_id AS voucher_id WHERE o.voucher_id IS NOT NULL
      UNION SELECT ov.voucher_id FROM blofy_store_order_vouchers ov
        WHERE ov.order_id=o.id
      UNION SELECT cv.voucher_id FROM blofy_store_cart_vouchers cv
        WHERE cv.order_id=o.id
      UNION SELECT r.voucher_id FROM blofy_store_renewal_orders r
        WHERE r.order_id=o.id
    ) assigned
    JOIN blofy_xtream_gateway_duration_codes v ON v.id=assigned.voucher_id
  ) ent ON TRUE
  WHERE o.status='paid'
   AND ($1::text='' OR
     strpos(lower(coalesce(o.public_order_number,'')),lower($1))>0 OR
     o.id::text=$1 OR
     strpos(lower(coalesce(c.full_name,'')),lower($1))>0 OR
     strpos(lower(coalesce(c.email,'')),lower($1))>0 OR
     strpos(coalesce(c.phone_e164,''),$1)>0)
   AND ($2='all' OR o.channel=$2 OR
        ($2='xtream' AND o.sku='cart'))
   AND ($3='all' OR coalesce(f.followup_status,'new')=$3)
  ORDER BY o.paid_at DESC NULLS LAST,o.created_at DESC,o.id DESC
  LIMIT 25 OFFSET $4`;
 const data=await pool.query(query,[q,channel,followup,offset]);
 const rows=data.rows||[],matched=Number(rows[0]?.matched||0);
 return {ok:true,items:rows.map(renderPaidLead),offset,matched,
   nextOffset:offset+rows.length<matched?offset+rows.length:null,
   pageSize:25,readOnly:true,scope:'recorded_paid_orders'};
}
export async function updatePaidLeadFollowup(pool,body={}){
 const orderId=String(body?.orderId??''),status=String(body?.followupStatus??''),
  note=String(body?.note??'').trim().replace(/[\r\n\t]+/g,' ');
 if(!UUID.test(orderId)||!FOLLOWUPS.has(status)||
  note.length>250||/[\x00-\x1f\x7f]/.test(note))
  throw failure('paid_lead_followup_invalid');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const row=(await db.query(`
   SELECT o.id,o.status,c.marketing_consent_at,
    f.followup_status
   FROM blofy_store_geidea_orders o
   LEFT JOIN blofy_store_customer_orders link ON link.order_id=o.id
   LEFT JOIN blofy_store_customers c ON c.id=link.customer_id
   LEFT JOIN blofy_store_paid_followups f ON f.order_id=o.id
   WHERE o.id=$1 FOR UPDATE OF o`,[orderId])).rows?.[0];
  if(!row||row.status!=='paid')throw failure('paid_lead_not_found',404);
  if(status==='offer_sent'&&!row.marketing_consent_at)
   throw failure('paid_lead_marketing_consent_required',409);
  if(row.followup_status==='do_not_contact'&&
     status!=='do_not_contact'&&status!=='new')
   throw failure('paid_lead_do_not_contact',409);
  await db.query(`INSERT INTO blofy_store_paid_followups
     (order_id,followup_status,followup_note,updated_at)
     VALUES($1,$2,$3,NOW()) ON CONFLICT(order_id) DO UPDATE SET
     followup_status=EXCLUDED.followup_status,
     followup_note=EXCLUDED.followup_note,updated_at=NOW()`,
   [orderId,status,note||null]);
  // Audit only the order ID and status; never record contact details or notes.
  await db.query(`INSERT INTO blofy_store_paid_followup_events
     (order_id,followup_status) VALUES($1,$2)`,[orderId,status]);
  await db.query('COMMIT');
  return {ok:true,orderId,followupStatus:status,saved:true};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
 finally{db.release()}
}

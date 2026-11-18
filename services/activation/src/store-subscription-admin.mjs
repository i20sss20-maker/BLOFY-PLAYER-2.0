// Read-only BLOFY ONE store subscriptions + Geidea renewal monitoring.
// Queries never reveal codes, credentials or encrypted vaults.
const STATES=new Set(['all','active','expiring','expired','unused','revoked','disabled']);
const PAY_STATES=new Set(['all','pending','paid','failed','cancelled']);
const PAGE_SIZE=25;
const OWNED="WITH bought AS ("+
 "SELECT m.customer_id,o.voucher_id FROM blofy_store_customer_orders m "+
 "JOIN blofy_store_geidea_orders o ON o.id=m.order_id "+
 "WHERE o.status='paid' AND o.sku NOT IN ('cart','bundle-2y','renewal') AND o.voucher_id IS NOT NULL "+
 "UNION SELECT m.customer_id,cv.voucher_id FROM blofy_store_customer_orders m "+
 "JOIN blofy_store_geidea_orders o ON o.id=m.order_id "+
 "JOIN blofy_store_cart_vouchers cv ON cv.order_id=o.id WHERE o.status='paid' AND o.sku='cart' "+
 "UNION SELECT m.customer_id,ov.voucher_id FROM blofy_store_customer_orders m "+
 "JOIN blofy_store_geidea_orders o ON o.id=m.order_id "+
 "JOIN blofy_store_order_vouchers ov ON ov.order_id=o.id WHERE o.status='paid' AND o.sku='bundle-2y'"+
 "), details AS ("+
 "SELECT b.customer_id,c.email,v.id AS voucher_id,v.code_channel,v.code_hint,"+
 "v.redeemed_at,v.revoked_at,v.account_id,"+
 "CASE WHEN v.expires_at IS NOT NULL AND a.expires_at IS NOT NULL "+
 "THEN LEAST(v.expires_at,a.expires_at) ELSE COALESCE(v.expires_at,a.expires_at) END AS effective_expiry,"+
 "a.enabled AS account_enabled FROM bought b "+
 "JOIN blofy_store_customers c ON c.id=b.customer_id "+
 "JOIN blofy_xtream_gateway_duration_codes v ON v.id=b.voucher_id "+
 "LEFT JOIN blofy_xtream_gateway_accounts a ON a.id=v.account_id"+
 "), states AS (SELECT details.*,"+
 "CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN redeemed_at IS NULL THEN 'unused' "+
 "WHEN account_id IS NULL OR account_enabled IS DISTINCT FROM TRUE OR effective_expiry IS NULL THEN 'disabled' "+
 "WHEN effective_expiry<=NOW() THEN 'expired' "+
 "WHEN effective_expiry<=NOW()+INTERVAL '7 days' THEN 'expiring' ELSE 'active' END AS state "+
 "FROM details)";
const RENEW_FROM=" FROM blofy_store_renewal_orders r "+
 "JOIN blofy_store_geidea_orders o ON o.id=r.order_id "+
 "JOIN blofy_store_customer_orders m ON m.order_id=o.id "+
 "JOIN blofy_store_customers c ON c.id=m.customer_id "+
 "JOIN blofy_xtream_gateway_duration_codes v ON v.id=r.voucher_id ";
export function parseOpsOptions(url){
 const view=url.searchParams.get('view')||'subscriptions',
   status=url.searchParams.get('status')||'all',
   q=url.searchParams.get('q')||'',
   page=Number(url.searchParams.get('page')||'1');
 if(!['subscriptions','renewals','sales'].includes(view)||
    !(view==='renewals'||view==='sales'?PAY_STATES:STATES).has(status)||
    typeof q!=='string'||q.length>100||/[\x00-\x1f\x7f]/.test(q)||
    !Number.isSafeInteger(page)||page<1||page>200)return null;
 return {view,status,q:q.trim(),page};
}
export function createStoreSubscriptionAdmin({pool,json,authorizeAdmin,ensureStoreSchema=async()=>{}}){
 async function handler(req,res,url){
  if(!authorizeAdmin(req,res))return true;
  const opts=parseOpsOptions(url);
  if(!opts)return json(res,400,{error:'invalid_store_operations_filter'});
  // The Geidea store schema is lazy-initialized on a new deployment. An admin
  // must not see a false missing-data error before the first cart purchase.
  // Only DDL/schema preparation is permitted here; no customer/payment writes.
  await ensureStoreSchema();
  const tables=['blofy_store_customers','blofy_store_customer_orders',
   'blofy_store_geidea_orders','blofy_store_renewal_orders',
   'blofy_xtream_gateway_duration_codes','blofy_xtream_gateway_accounts',
   'blofy_store_customer_reminders'];
  const availability=(await pool.query('SELECT '+tables.map((_,i)=>
   'to_regclass($'+(i+1)+') AS t'+i).join(','),tables.map(t=>'public.'+t))).rows[0]||{};
  if(tables.slice(0,6).some((_,i)=>!availability['t'+i]))
   return json(res,503,{error:'store_operations_schema_unavailable'});
  // The entire BLOFY STORE sales table is distinct from PLAYER activation
  // and manual WhatsApp sales. This admin-only view reads recorded Geidea
  // order states; it does not call the payment provider, capture money,
  // issue vouchers, decrypt codes, or infer bank settlement.
  if(opts.view==='sales'){
   const rows=(await pool.query(
    'SELECT COUNT(*)::int AS total,'+
    "COUNT(*) FILTER(WHERE status='paid')::int AS paid,"+
    "COUNT(*) FILTER(WHERE status='pending')::int AS pending,"+
    "COUNT(*) FILTER(WHERE status='failed')::int AS failed,"+
    "COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,"+
    "COUNT(*) FILTER(WHERE status='pending' AND created_at<NOW()-INTERVAL '20 minutes')::int AS overdue,"+
    "COALESCE(SUM(amount_minor) FILTER(WHERE status='paid'),0)::bigint::text AS paid_amount_minor,"+
    "COALESCE(SUM(amount_minor) FILTER(WHERE status='paid' AND paid_at>=NOW()-INTERVAL '30 days'),0)::bigint::text AS paid_last30_minor "+
    'FROM blofy_store_geidea_orders')).rows[0]||{};
   const term=opts.q?'%'+opts.q.replace(/[\\%_]/g,x=>'\\'+x)+'%':'';
   const statusClause=opts.status==='all'?'':' AND o.status=$2';
   const args=opts.status==='all'?
     [term,PAGE_SIZE,(opts.page-1)*PAGE_SIZE]:
     [term,opts.status,PAGE_SIZE,(opts.page-1)*PAGE_SIZE];
   const limit=opts.status==='all'?'2':'3';
   const offset=opts.status==='all'?'3':'4';
   const selected=await pool.query(
    'SELECT o.id,o.public_order_number,o.status,o.sku,o.channel,'+
    'o.amount_minor,o.currency,o.created_at,o.paid_at,'+
    'c.email,COUNT(*) OVER() AS matched '+
    'FROM blofy_store_geidea_orders o '+
    'LEFT JOIN blofy_store_customer_orders m ON m.order_id=o.id '+
    'LEFT JOIN blofy_store_customers c ON c.id=m.customer_id '+
    "WHERE ($1::text='' OR o.public_order_number ILIKE $1 "+
    "OR o.id::text ILIKE $1 OR c.email ILIKE $1)"+
    statusClause+' ORDER BY o.created_at DESC,o.id DESC LIMIT 
   "COUNT(*) FILTER(WHERE o.status='paid')::int AS paid,"+
   "COUNT(*) FILTER(WHERE o.status='pending')::int AS pending,"+
   "COUNT(*) FILTER(WHERE o.status='failed')::int AS failed,"+
   "COUNT(*) FILTER(WHERE o.status='cancelled')::int AS cancelled,"+
   "COUNT(*) FILTER(WHERE o.status='pending' AND o.created_at<NOW()-INTERVAL '20 minutes')::int AS overdue,"+
   "COALESCE(SUM(o.amount_minor) FILTER(WHERE o.status='paid'),0)::bigint::text AS paid_amount_minor"+
   RENEW_FROM)).rows[0]||{};
  // Sent means the provider accepted the send request, not that the customer opened it.
  // Missing reminder table is explicitly unknown, never represented as zero.
  const reminder=availability.t6?(await pool.query(
   'SELECT COUNT(*) FILTER(WHERE sent_at IS NOT NULL)::int AS sent,'+
   'COUNT(*) FILTER(WHERE sent_at IS NULL AND attempts>=3)::int AS exhausted,'+
   'COUNT(*) FILTER(WHERE sent_at IS NULL AND attempts>0 AND attempts<3)::int AS retrying '+
   'FROM blofy_store_customer_reminders')).rows[0]||{}:null;
  const pattern=opts.q?'%'+opts.q.replace(/[\\%_]/g,x=>'\\'+x)+'%':'';
  const whereStatus=opts.status==='all'?'':' AND '+(opts.view==='renewals'?'o.status':'state')+'=$2';
  const args=opts.status==='all'?[pattern,PAGE_SIZE,(opts.page-1)*PAGE_SIZE]:
    [pattern,opts.status,PAGE_SIZE,(opts.page-1)*PAGE_SIZE];
  const limit=opts.status==='all'?'2':'3',offset=opts.status==='all'?'3':'4';
  let result,counts=null;
  if(opts.view==='renewals'){
   result=await pool.query(
    'SELECT o.id AS order_id,o.public_order_number,o.status,o.amount_minor,'+
    'o.duration_days,o.created_at,o.paid_at,r.voucher_id,r.plan_sku,c.email,'+
    'v.code_hint,v.code_channel,v.expires_at,COUNT(*) OVER() AS matched'+RENEW_FROM+
    "WHERE ($1::text='' OR c.email ILIKE $1 OR o.public_order_number ILIKE $1 "+
    'OR v.code_hint ILIKE $1 OR o.id::text ILIKE $1 OR v.id::text ILIKE $1)'+
    whereStatus+' ORDER BY o.created_at DESC,o.id DESC LIMIT $'+limit+' OFFSET $'+offset,args);
  }else{
   counts=(await pool.query(OWNED+
    ' SELECT COUNT(*)::int AS total,'+
    "COUNT(*) FILTER(WHERE state='active')::int AS active,"+
    "COUNT(*) FILTER(WHERE state='expiring')::int AS expiring,"+
    "COUNT(*) FILTER(WHERE state='expired')::int AS expired,"+
    "COUNT(*) FILTER(WHERE state='unused')::int AS unused,"+
    "COUNT(*) FILTER(WHERE state='revoked')::int AS revoked,"+
    "COUNT(*) FILTER(WHERE state='disabled')::int AS disabled FROM states")).rows[0]||null;
   result=await pool.query(OWNED+
    ' SELECT customer_id,email,voucher_id,code_channel,code_hint,redeemed_at,'+
    'effective_expiry AS expires_at,state,COUNT(*) OVER() AS matched FROM states '+
    "WHERE ($1::text='' OR email ILIKE $1 OR code_hint ILIKE $1 OR voucher_id::text ILIKE $1)"+
    whereStatus+' ORDER BY effective_expiry ASC NULLS LAST,voucher_id DESC LIMIT $'+
    limit+' OFFSET $'+offset,args);
  }
  const items=(result.rows||[]).map(row=>opts.view==='renewals'
   ?{orderId:row.order_id,orderNumber:row.public_order_number||null,
     email:row.email,codeHint:row.code_hint||'',voucherId:row.voucher_id,
     channel:row.code_channel,status:row.status,planSku:row.plan_sku,
     durationDays:Number(row.duration_days),amountMinor:Number(row.amount_minor),
     createdAt:row.created_at,paidAt:row.paid_at||null,expiresAt:row.expires_at||null}
   :{customerId:row.customer_id,email:row.email,voucherId:row.voucher_id,
     codeHint:row.code_hint||'',channel:row.code_channel,status:row.state,
     redeemedAt:row.redeemed_at||null,expiresAt:row.expires_at||null});
  return json(res,200,{ok:true,view:opts.view,status:opts.status,
   page:opts.page,pageSize:PAGE_SIZE,matched:Number(result.rows?.[0]?.matched||0),
   subscriptions:counts,
   reminders:reminder?{acceptedByProvider:Number(reminder.sent||0),
    exhaustedRetries:Number(reminder.exhausted||0),retrying:Number(reminder.retrying||0)}:null,
   renewals:{total:Number(summary.total||0),paid:Number(summary.paid||0),
    pending:Number(summary.pending||0),failed:Number(summary.failed||0),
    cancelled:Number(summary.cancelled||0),pendingOver20m:Number(summary.overdue||0),
    paidAmountMinor:String(summary.paid_amount_minor||'0')},
   items,readOnly:true,
   note:'BLOFY database payment states are not independent bank settlement proof'});
 }
 return {handler};
}
+
    limit+' OFFSET 
   "COUNT(*) FILTER(WHERE o.status='paid')::int AS paid,"+
   "COUNT(*) FILTER(WHERE o.status='pending')::int AS pending,"+
   "COUNT(*) FILTER(WHERE o.status='failed')::int AS failed,"+
   "COUNT(*) FILTER(WHERE o.status='cancelled')::int AS cancelled,"+
   "COUNT(*) FILTER(WHERE o.status='pending' AND o.created_at<NOW()-INTERVAL '20 minutes')::int AS overdue,"+
   "COALESCE(SUM(o.amount_minor) FILTER(WHERE o.status='paid'),0)::bigint::text AS paid_amount_minor"+
   RENEW_FROM)).rows[0]||{};
  // Sent means the provider accepted the send request, not that the customer opened it.
  // Missing reminder table is explicitly unknown, never represented as zero.
  const reminder=availability.t6?(await pool.query(
   'SELECT COUNT(*) FILTER(WHERE sent_at IS NOT NULL)::int AS sent,'+
   'COUNT(*) FILTER(WHERE sent_at IS NULL AND attempts>=3)::int AS exhausted,'+
   'COUNT(*) FILTER(WHERE sent_at IS NULL AND attempts>0 AND attempts<3)::int AS retrying '+
   'FROM blofy_store_customer_reminders')).rows[0]||{}:null;
  const pattern=opts.q?'%'+opts.q.replace(/[\\%_]/g,x=>'\\'+x)+'%':'';
  const whereStatus=opts.status==='all'?'':' AND '+(opts.view==='renewals'?'o.status':'state')+'=$2';
  const args=opts.status==='all'?[pattern,PAGE_SIZE,(opts.page-1)*PAGE_SIZE]:
    [pattern,opts.status,PAGE_SIZE,(opts.page-1)*PAGE_SIZE];
  const limit=opts.status==='all'?'2':'3',offset=opts.status==='all'?'3':'4';
  let result,counts=null;
  if(opts.view==='renewals'){
   result=await pool.query(
    'SELECT o.id AS order_id,o.public_order_number,o.status,o.amount_minor,'+
    'o.duration_days,o.created_at,o.paid_at,r.voucher_id,r.plan_sku,c.email,'+
    'v.code_hint,v.code_channel,v.expires_at,COUNT(*) OVER() AS matched'+RENEW_FROM+
    "WHERE ($1::text='' OR c.email ILIKE $1 OR o.public_order_number ILIKE $1 "+
    'OR v.code_hint ILIKE $1 OR o.id::text ILIKE $1 OR v.id::text ILIKE $1)'+
    whereStatus+' ORDER BY o.created_at DESC,o.id DESC LIMIT $'+limit+' OFFSET $'+offset,args);
  }else{
   counts=(await pool.query(OWNED+
    ' SELECT COUNT(*)::int AS total,'+
    "COUNT(*) FILTER(WHERE state='active')::int AS active,"+
    "COUNT(*) FILTER(WHERE state='expiring')::int AS expiring,"+
    "COUNT(*) FILTER(WHERE state='expired')::int AS expired,"+
    "COUNT(*) FILTER(WHERE state='unused')::int AS unused,"+
    "COUNT(*) FILTER(WHERE state='revoked')::int AS revoked,"+
    "COUNT(*) FILTER(WHERE state='disabled')::int AS disabled FROM states")).rows[0]||null;
   result=await pool.query(OWNED+
    ' SELECT customer_id,email,voucher_id,code_channel,code_hint,redeemed_at,'+
    'effective_expiry AS expires_at,state,COUNT(*) OVER() AS matched FROM states '+
    "WHERE ($1::text='' OR email ILIKE $1 OR code_hint ILIKE $1 OR voucher_id::text ILIKE $1)"+
    whereStatus+' ORDER BY effective_expiry ASC NULLS LAST,voucher_id DESC LIMIT $'+
    limit+' OFFSET $'+offset,args);
  }
  const items=(result.rows||[]).map(row=>opts.view==='renewals'
   ?{orderId:row.order_id,orderNumber:row.public_order_number||null,
     email:row.email,codeHint:row.code_hint||'',voucherId:row.voucher_id,
     channel:row.code_channel,status:row.status,planSku:row.plan_sku,
     durationDays:Number(row.duration_days),amountMinor:Number(row.amount_minor),
     createdAt:row.created_at,paidAt:row.paid_at||null,expiresAt:row.expires_at||null}
   :{customerId:row.customer_id,email:row.email,voucherId:row.voucher_id,
     codeHint:row.code_hint||'',channel:row.code_channel,status:row.state,
     redeemedAt:row.redeemed_at||null,expiresAt:row.expires_at||null});
  return json(res,200,{ok:true,view:opts.view,status:opts.status,
   page:opts.page,pageSize:PAGE_SIZE,matched:Number(result.rows?.[0]?.matched||0),
   subscriptions:counts,
   reminders:reminder?{acceptedByProvider:Number(reminder.sent||0),
    exhaustedRetries:Number(reminder.exhausted||0),retrying:Number(reminder.retrying||0)}:null,
   renewals:{total:Number(summary.total||0),paid:Number(summary.paid||0),
    pending:Number(summary.pending||0),failed:Number(summary.failed||0),
    cancelled:Number(summary.cancelled||0),pendingOver20m:Number(summary.overdue||0),
    paidAmountMinor:String(summary.paid_amount_minor||'0')},
   items,readOnly:true,
   note:'BLOFY database payment states are not independent bank settlement proof'});
 }
 return {handler};
}
+offset,args);
   return json(res,200,{
    ok:true,view:'sales',status:opts.status,page:opts.page,
    pageSize:PAGE_SIZE,matched:Number(selected.rows?.[0]?.matched||0),
    sales:{
     total:Number(rows.total||0),paid:Number(rows.paid||0),
     pending:Number(rows.pending||0),failed:Number(rows.failed||0),
     cancelled:Number(rows.cancelled||0),pendingOver20m:Number(rows.overdue||0),
     paidAmountMinor:String(rows.paid_amount_minor||'0'),
     paidLast30Minor:String(rows.paid_last30_minor||'0')
    },
    subscriptions:null,renewals:null,reminders:null,
    items:(selected.rows||[]).map(row=>({
     orderId:row.id,orderNumber:row.public_order_number||null,
     email:row.email||null,sku:row.sku,channel:row.channel,
     status:row.status,amountMinor:Number(row.amount_minor),
     currency:row.currency,createdAt:row.created_at,
     paidAt:row.paid_at||null
    })),
    readOnly:true,
    note:'Stored Geidea order states, not independent bank settlement proof or code-delivery confirmation'
   });
  }
  const summary=(await pool.query(
   'SELECT COUNT(*)::int AS total,'+
   "COUNT(*) FILTER(WHERE o.status='paid')::int AS paid,"+
   "COUNT(*) FILTER(WHERE o.status='pending')::int AS pending,"+
   "COUNT(*) FILTER(WHERE o.status='failed')::int AS failed,"+
   "COUNT(*) FILTER(WHERE o.status='cancelled')::int AS cancelled,"+
   "COUNT(*) FILTER(WHERE o.status='pending' AND o.created_at<NOW()-INTERVAL '20 minutes')::int AS overdue,"+
   "COALESCE(SUM(o.amount_minor) FILTER(WHERE o.status='paid'),0)::bigint::text AS paid_amount_minor"+
   RENEW_FROM)).rows[0]||{};
  // Sent means the provider accepted the send request, not that the customer opened it.
  // Missing reminder table is explicitly unknown, never represented as zero.
  const reminder=availability.t6?(await pool.query(
   'SELECT COUNT(*) FILTER(WHERE sent_at IS NOT NULL)::int AS sent,'+
   'COUNT(*) FILTER(WHERE sent_at IS NULL AND attempts>=3)::int AS exhausted,'+
   'COUNT(*) FILTER(WHERE sent_at IS NULL AND attempts>0 AND attempts<3)::int AS retrying '+
   'FROM blofy_store_customer_reminders')).rows[0]||{}:null;
  const pattern=opts.q?'%'+opts.q.replace(/[\\%_]/g,x=>'\\'+x)+'%':'';
  const whereStatus=opts.status==='all'?'':' AND '+(opts.view==='renewals'?'o.status':'state')+'=$2';
  const args=opts.status==='all'?[pattern,PAGE_SIZE,(opts.page-1)*PAGE_SIZE]:
    [pattern,opts.status,PAGE_SIZE,(opts.page-1)*PAGE_SIZE];
  const limit=opts.status==='all'?'2':'3',offset=opts.status==='all'?'3':'4';
  let result,counts=null;
  if(opts.view==='renewals'){
   result=await pool.query(
    'SELECT o.id AS order_id,o.public_order_number,o.status,o.amount_minor,'+
    'o.duration_days,o.created_at,o.paid_at,r.voucher_id,r.plan_sku,c.email,'+
    'v.code_hint,v.code_channel,v.expires_at,COUNT(*) OVER() AS matched'+RENEW_FROM+
    "WHERE ($1::text='' OR c.email ILIKE $1 OR o.public_order_number ILIKE $1 "+
    'OR v.code_hint ILIKE $1 OR o.id::text ILIKE $1 OR v.id::text ILIKE $1)'+
    whereStatus+' ORDER BY o.created_at DESC,o.id DESC LIMIT $'+limit+' OFFSET $'+offset,args);
  }else{
   counts=(await pool.query(OWNED+
    ' SELECT COUNT(*)::int AS total,'+
    "COUNT(*) FILTER(WHERE state='active')::int AS active,"+
    "COUNT(*) FILTER(WHERE state='expiring')::int AS expiring,"+
    "COUNT(*) FILTER(WHERE state='expired')::int AS expired,"+
    "COUNT(*) FILTER(WHERE state='unused')::int AS unused,"+
    "COUNT(*) FILTER(WHERE state='revoked')::int AS revoked,"+
    "COUNT(*) FILTER(WHERE state='disabled')::int AS disabled FROM states")).rows[0]||null;
   result=await pool.query(OWNED+
    ' SELECT customer_id,email,voucher_id,code_channel,code_hint,redeemed_at,'+
    'effective_expiry AS expires_at,state,COUNT(*) OVER() AS matched FROM states '+
    "WHERE ($1::text='' OR email ILIKE $1 OR code_hint ILIKE $1 OR voucher_id::text ILIKE $1)"+
    whereStatus+' ORDER BY effective_expiry ASC NULLS LAST,voucher_id DESC LIMIT $'+
    limit+' OFFSET $'+offset,args);
  }
  const items=(result.rows||[]).map(row=>opts.view==='renewals'
   ?{orderId:row.order_id,orderNumber:row.public_order_number||null,
     email:row.email,codeHint:row.code_hint||'',voucherId:row.voucher_id,
     channel:row.code_channel,status:row.status,planSku:row.plan_sku,
     durationDays:Number(row.duration_days),amountMinor:Number(row.amount_minor),
     createdAt:row.created_at,paidAt:row.paid_at||null,expiresAt:row.expires_at||null}
   :{customerId:row.customer_id,email:row.email,voucherId:row.voucher_id,
     codeHint:row.code_hint||'',channel:row.code_channel,status:row.state,
     redeemedAt:row.redeemed_at||null,expiresAt:row.expires_at||null});
  return json(res,200,{ok:true,view:opts.view,status:opts.status,
   page:opts.page,pageSize:PAGE_SIZE,matched:Number(result.rows?.[0]?.matched||0),
   subscriptions:counts,
   reminders:reminder?{acceptedByProvider:Number(reminder.sent||0),
    exhaustedRetries:Number(reminder.exhausted||0),retrying:Number(reminder.retrying||0)}:null,
   renewals:{total:Number(summary.total||0),paid:Number(summary.paid||0),
    pending:Number(summary.pending||0),failed:Number(summary.failed||0),
    cancelled:Number(summary.cancelled||0),pendingOver20m:Number(summary.overdue||0),
    paidAmountMinor:String(summary.paid_amount_minor||'0')},
   items,readOnly:true,
   note:'BLOFY database payment states are not independent bank settlement proof'});
 }
 return {handler};
}

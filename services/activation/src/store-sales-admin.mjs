// Owner-authenticated caller only. Read-only summary of recorded BLOFY STORE orders.
// This module is not an independent public HTTP endpoint and never performs checkout.
const PAGE_SIZE=25;

export async function readStoreSalesReport({pool,json,res,opts}){
 const summarySQL=[
  'SELECT COUNT(*)::int AS total,',
  "COUNT(*) FILTER(WHERE status='paid')::int AS paid,",
  "COUNT(*) FILTER(WHERE status='pending')::int AS pending,",
  "COUNT(*) FILTER(WHERE status='failed')::int AS failed,",
  "COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,",
  "COUNT(*) FILTER(WHERE status='pending' AND created_at<NOW()-INTERVAL '20 minutes')::int AS overdue,",
  "COALESCE(SUM(amount_minor) FILTER(WHERE status='paid'),0)::bigint::text AS paid_amount_minor,",
  "COALESCE(SUM(amount_minor) FILTER(WHERE status='paid' AND paid_at>=NOW()-INTERVAL '30 days'),0)::bigint::text AS paid_last30_minor ",
  'FROM blofy_store_geidea_orders'
 ].join('');
 const total=(await pool.query(summarySQL)).rows[0]||{};
 // Escape LIKE wildcards: customer input is data, not SQL syntax or a regexp.
 const term=opts.q?'%'+opts.q.replace(/[\\%_]/g,ch=>'\\'+ch)+'%':'';
 const unfiltered=opts.status==='all';
 const params=unfiltered?
  [term,PAGE_SIZE,(opts.page-1)*PAGE_SIZE]:
  [term,opts.status,PAGE_SIZE,(opts.page-1)*PAGE_SIZE];
 const limit=unfiltered?'2':'3',offset=unfiltered?'3':'4';
 const statusSQL=unfiltered?'':' AND o.status=$2';
 const sql=[
  'SELECT o.id,o.public_order_number,o.status,o.sku,o.channel,',
  'o.amount_minor,o.currency,o.created_at,o.paid_at,c.email,',
  'COUNT(*) OVER() AS matched FROM blofy_store_geidea_orders o ',
  'LEFT JOIN blofy_store_customer_orders m ON m.order_id=o.id ',
  'LEFT JOIN blofy_store_customers c ON c.id=m.customer_id ',
  "WHERE ($1::text='' OR o.public_order_number ILIKE $1 ",
  "OR o.id::text ILIKE $1 OR c.email ILIKE $1)",
  statusSQL,' ORDER BY o.created_at DESC,o.id DESC LIMIT $',limit,' OFFSET $',offset
 ].join('');
 const listed=await pool.query(sql,params);
 const items=(listed.rows||[]).map(row=>({
  orderId:row.id,orderNumber:row.public_order_number||null,
  email:row.email||null,sku:row.sku,channel:row.channel,
  status:row.status,amountMinor:Number(row.amount_minor),
  currency:row.currency,createdAt:row.created_at,
  paidAt:row.paid_at||null
 }));
 return json(res,200,{
  ok:true,view:'sales',status:opts.status,page:opts.page,
  pageSize:PAGE_SIZE,matched:Number(listed.rows?.[0]?.matched||0),
  sales:{
   total:Number(total.total||0),paid:Number(total.paid||0),
   pending:Number(total.pending||0),failed:Number(total.failed||0),
   cancelled:Number(total.cancelled||0),pendingOver20m:Number(total.overdue||0),
   paidAmountMinor:String(total.paid_amount_minor||'0'),
   paidLast30Minor:String(total.paid_last30_minor||'0')
  },
  subscriptions:null,renewals:null,reminders:null,
  items,readOnly:true,
  note:'Recorded order states do not independently prove bank settlement or voucher delivery'
 });
}

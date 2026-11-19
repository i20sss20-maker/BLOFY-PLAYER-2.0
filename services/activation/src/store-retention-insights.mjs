// Privacy-first retention reporting: saved carts and customer consent only.
// This is NOT a mailing list export. No customer PII or discount data leaves this API.
export function createStoreRetentionInsightsHandlers({pool,json,authorizeAdmin}){
 return async (req,res,url)=>{
  if(url.pathname!=='/api/v1/admin/store/retention')return false;
  if(!authorizeAdmin(req,res))return true;
  if(req.method!=='GET'){json(res,405,{error:'method_not_allowed'});return true;}
  const sql={
   customers:"SELECT COUNT(*)::int AS total,"+
    "COUNT(*) FILTER (WHERE alerts_opt_in IS TRUE)::int AS opted_in,"+
    "COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '30 days')::int AS new_30d "+
    "FROM blofy_store_customers",
   carts:"SELECT COUNT(*)::int AS saved_total,"+
    "COUNT(*) FILTER (WHERE updated_at >= NOW()-INTERVAL '7 days')::int AS changed_7d,"+
    "COUNT(*) FILTER (WHERE updated_at >= NOW()-INTERVAL '30 days' AND "+
    "updated_at < NOW()-INTERVAL '1 day')::int AS older_than_day_30d "+
    "FROM blofy_store_customer_carts "+
    "WHERE jsonb_typeof(items)='array' AND jsonb_array_length(items)>0",
   renewals:"SELECT COUNT(*)::int AS renewal_orders,"+
    "COUNT(*) FILTER (WHERE o.status='paid')::int AS paid_renewals "+
    "FROM blofy_store_renewal_orders r JOIN blofy_store_geidea_orders o ON o.id=r.order_id "+
    "WHERE o.created_at>=NOW()-INTERVAL '30 days'"
  };
  const exists=(await pool.query("SELECT "+
    "to_regclass('public.blofy_store_customers') AS customers,"+
    "to_regclass('public.blofy_store_customer_carts') AS carts,"+
    "to_regclass('public.blofy_store_renewal_orders') AS renewals,"+
    "to_regclass('public.blofy_store_geidea_orders') AS orders")).rows[0]||{};
  const safe=async(name,ok)=>ok?(await pool.query(sql[name])).rows[0]:{};
  const [customers,carts,renewals]=await Promise.all([
   safe('customers',exists.customers),safe('carts',exists.carts),
   safe('renewals',exists.renewals&&exists.orders)
  ]);
  json(res,200,{ok:true,windowDays:30,
    note:'إحصاءات وصفية فقط. السلة المحفوظة ليست بالضرورة سلة مهجورة ولا تُرسل رسائل إلا بموافقة صريحة.',
    customers:{
      total:Number(customers.total||0),
      marketingOptIn:Number(customers.opted_in||0),
      new30Days:Number(customers.new_30d||0)},
    savedCarts:{
      total:Number(carts.saved_total||0),
      changedLast7Days:Number(carts.changed_7d||0),
      olderThanDayLast30Days:Number(carts.older_than_day_30d||0)
    },
    renewals:{attempts30Days:Number(renewals.renewal_orders||0),paid30Days:Number(renewals.paid_renewals||0)},
    notifications:{emailReminders:'existing_worker_only',marketing:'not_automatically_sent'}
  });
  return true;
 };
}

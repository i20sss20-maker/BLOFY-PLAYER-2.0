// BLOFY PRO read-only readiness board. Flags reflect configured capabilities, not a successful bank charge.
export function publicStoreProFlags(env=process.env){
 const hasEmail=String(env.BLOFY_CUSTOMER_RESEND_API_KEY||'').startsWith('re_')&&
   String(env.BLOFY_CUSTOMER_MAIL_FROM||'').includes('@');
 const geidea=env.BLOFY_PAYMENT_PROVIDER==='geidea'&&
   env.BLOFY_GEIDEA_CHECKOUT_ENABLED==='true'&&env.BLOFY_STORE_GEIDEA_ENABLED==='true';
 return {
   payment:{geideaConfigured:geidea,applePayVisible:env.BLOFY_GEIDEA_APPLE_PAY_ENABLED==='true',
     googlePaySupported:false,verifiedLivePurchase:false},
   customer:{accountsEnabled:env.BLOFY_CUSTOMER_ACCOUNTS_ENABLED==='true',
     emailConfigured:hasEmail,renewalEnabled:env.BLOFY_STORE_SAME_CODE_RENEWAL_ENABLED==='true',
     expiryRemindersConfigured:hasEmail&&env.BLOFY_CUSTOMER_REMINDERS_ENABLED==='true',
     cartRecoveryConfigured:hasEmail&&env.BLOFY_STORE_CART_RECOVERY_ENABLED==='true'},
   assistant:{aiConfigured:env.BLOFY_STORE_AI_ENABLED==='true'&&String(env.OPENAI_API_KEY||'').startsWith('sk-'),
     guideAvailable:true},
   marketing:{requiresSeparateConsent:true,bulkMessagesEnabled:false}
 };
}
export function createStoreProReadinessHandlers({pool,json,authorizeAdmin,env=process.env}){
 return async function handler(req,res,url){
  if(url.pathname!=='/api/v1/admin/store/pro-readiness')return false;
  if(!authorizeAdmin(req,res))return true;
  if(req.method!=='GET'){json(res,405,{error:'method_not_allowed'});return true;}
  const flags=publicStoreProFlags(env);
  const schema=(await pool.query(
    "SELECT to_regclass('public.blofy_store_customer_carts') AS carts,"+
    "to_regclass('public.blofy_store_customers') AS customers,"+
    "to_regclass('public.blofy_store_customer_orders') AS owners,"+
    "to_regclass('public.blofy_store_geidea_orders') AS orders,"+
    "to_regclass('public.blofy_store_customer_reminders') AS reminders"
  )).rows[0]||{};
  const counts={customers:null,optedInMarketing:null,possibleAbandonedCarts:null,
    pendingOrders:null,failedOrders:null,paidOrders:null,reminderEmailsAccepted:null};
  if(schema.customers){
   const x=(await pool.query(
    'SELECT COUNT(*)::int AS customers,'+
    'COUNT(*) FILTER (WHERE marketing_opt_in=TRUE)::int AS marketing '+
    'FROM blofy_store_customers'
   )).rows[0]||{};
   counts.customers=Number(x.customers||0);
   counts.optedInMarketing=Number(x.marketing||0);
  }
  if(schema.carts&&schema.customers&&schema.owners&&schema.orders){
   const x=(await pool.query(
    "SELECT COUNT(*)::int AS carts FROM blofy_store_customer_carts c "+
    "JOIN blofy_store_customers u ON u.id=c.customer_id "+
    "WHERE c.updated_at<NOW()-INTERVAL '24 hours' "+
    "AND c.updated_at>NOW()-INTERVAL '14 days' "+
    "AND jsonb_typeof(c.items)='array' AND jsonb_array_length(c.items)>0 "+
    "AND NOT EXISTS (SELECT 1 FROM blofy_store_customer_orders co "+
    "JOIN blofy_store_geidea_orders o ON o.id=co.order_id "+
    "WHERE co.customer_id=c.customer_id AND o.status='paid' AND o.created_at>=c.updated_at)"
   )).rows[0]||{};
   counts.possibleAbandonedCarts=Number(x.carts||0);
  }
  if(schema.orders){
   const x=(await pool.query(
    "SELECT COUNT(*) FILTER (WHERE status='paid')::int AS paid,"+
    "COUNT(*) FILTER (WHERE status='pending')::int AS pending,"+
    "COUNT(*) FILTER (WHERE status='failed')::int AS failed "+
    "FROM blofy_store_geidea_orders WHERE created_at>=NOW()-INTERVAL '24 hours'"
   )).rows[0]||{};
   counts.paidOrders=Number(x.paid||0);counts.pendingOrders=Number(x.pending||0);
   counts.failedOrders=Number(x.failed||0);
  }
  if(schema.reminders){
   counts.reminderEmailsAccepted=Number((await pool.query(
     'SELECT COUNT(*)::int AS n FROM blofy_store_customer_reminders WHERE sent_at IS NOT NULL'
   )).rows[0]?.n||0);
  }
  json(res,200,{ok:true,flags,counts,readOnly:true,
    message:'Counts are based on BLOFY database records, not independent bank settlement; marketing requires explicit customer consent.'});
  return true;
 };
}

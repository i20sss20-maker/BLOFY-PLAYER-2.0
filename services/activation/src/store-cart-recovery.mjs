// Opt-in only abandoned-cart recovery. Disabled by default and never sends codes/payment links.
// Requires separately saved marketing consent and a configured Resend sender.
export function cartRecoveryEnabled(env=process.env){
 return env.BLOFY_CUSTOMER_ACCOUNTS_ENABLED==='true'&&
   env.BLOFY_STORE_CART_RECOVERY_ENABLED==='true'&&
   String(env.BLOFY_CUSTOMER_RESEND_API_KEY||'').startsWith('re_')&&
   String(env.BLOFY_CUSTOMER_MAIL_FROM||'').includes('@');
}
export function createCartRecoveryEngine({pool,env=process.env,fetchImpl=globalThis.fetch,sendEmail}){
 const enabled=cartRecoveryEnabled(env);
 let migration=null;
 const key=String(env.BLOFY_CUSTOMER_RESEND_API_KEY||''),from=String(env.BLOFY_CUSTOMER_MAIL_FROM||'');
 async function schema(){
  if(!migration)migration=(async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(718420719)');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_cart_recovery_emails ('+
      'customer_id UUID NOT NULL REFERENCES blofy_store_customers(id) ON DELETE CASCADE,'+
      'revision BIGINT NOT NULL,attempts SMALLINT NOT NULL DEFAULT 0,'+
      'lease_until TIMESTAMPTZ,sent_at TIMESTAMPTZ,'+
      'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),'+
      'PRIMARY KEY(customer_id,revision))');
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
  })().catch(e=>{migration=null;throw e;});
  return migration;
 }
 const eligibility=" FROM blofy_store_customer_carts c "+
    "JOIN blofy_store_customers u ON u.id=c.customer_id "+
    "WHERE u.marketing_opt_in=TRUE AND c.items IS NOT NULL "+
    "AND jsonb_typeof(c.items)='array' AND jsonb_array_length(c.items)>0 "+
    "AND c.updated_at<NOW()-INTERVAL '24 hours' "+
    "AND c.updated_at>NOW()-INTERVAL '14 days' "+
    "AND NOT EXISTS (SELECT 1 FROM blofy_store_customer_orders co "+
    "JOIN blofy_store_geidea_orders o ON o.id=co.order_id "+
    "WHERE co.customer_id=c.customer_id AND o.status='paid' "+
    "AND o.created_at>=c.updated_at)";
 async function deliver(email,job){
  const msg={
   from,to:[email],subject:'باقتك ما زالت في سلة BLOFY',
   text:'مرحبًا! إذا كنت لا تزال ترغب في إكمال طلبك، افتح سلة BLOFY من الرابط الرسمي: '+
     'https://blofyplayer.com/store/cart\n\nلن يتم خصم أي مبلغ حتى توافق على الدفع لدى جيديا.'+
     '\nللإلغاء افتح https://blofyplayer.com/store/account وأوقف موافقة العروض وتذكير السلة.'+
     '\nلا تشارك بيانات دفعك أو أكوادك.'
  };
  const idempotency='blofy-recovery-v1-'+job.customer_id+'-'+job.revision;
  if(sendEmail)return sendEmail(email,msg,idempotency);
  const response=await fetchImpl('https://api.resend.com/emails',{
   method:'POST',
   headers:{authorization:'Bearer '+key,'content-type':'application/json','Idempotency-Key':idempotency},
   body:JSON.stringify(msg),signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error('cart_recovery_email_send_failed');
 }
 async function run(){
  if(!enabled)return {enabled:false};
  const tables=['blofy_store_customers','blofy_store_customer_carts','blofy_store_customer_orders','blofy_store_geidea_orders'];
  const check=await pool.query('SELECT '+tables.map((_,i)=>"to_regclass($"+(i+1)+") AS t"+i).join(','),
    tables.map(x=>'public.'+x));
  if(tables.some((_,i)=>!check.rows[0]?.['t'+i]))return {enabled:true,ready:false};
  await schema();
  const inserted=await pool.query(
   'INSERT INTO blofy_store_cart_recovery_emails(customer_id,revision) '+
   'SELECT c.customer_id,c.revision'+eligibility+
   ' ORDER BY c.updated_at ASC LIMIT 100 ON CONFLICT DO NOTHING'
  );
  const db=await pool.connect();let jobs=[];
  try{
   await db.query('BEGIN');
   jobs=(await db.query(
    'WITH todo AS (SELECT r.customer_id,r.revision FROM blofy_store_cart_recovery_emails r '+
    'JOIN blofy_store_customer_carts c ON c.customer_id=r.customer_id AND c.revision=r.revision '+
    'JOIN blofy_store_customers u ON u.id=r.customer_id '+
    "WHERE r.sent_at IS NULL AND r.attempts<3 AND u.marketing_opt_in=TRUE "+
    "AND (r.lease_until IS NULL OR r.lease_until<NOW()) "+
    "AND c.updated_at<NOW()-INTERVAL '24 hours' "+
    "AND c.updated_at>NOW()-INTERVAL '14 days' "+
    "AND jsonb_typeof(c.items)='array' AND jsonb_array_length(c.items)>0 "+
    "AND NOT EXISTS (SELECT 1 FROM blofy_store_customer_orders co "+
    "JOIN blofy_store_geidea_orders o ON o.id=co.order_id WHERE co.customer_id=c.customer_id "+
    "AND o.status='paid' AND o.created_at>=c.updated_at) "+
    'ORDER BY r.created_at LIMIT 5 FOR UPDATE OF r SKIP LOCKED) '+
    'UPDATE blofy_store_cart_recovery_emails r '+
    "SET attempts=r.attempts+1,lease_until=NOW()+INTERVAL '6 minutes' "+
    'FROM todo t WHERE r.customer_id=t.customer_id AND r.revision=t.revision '+
    'RETURNING r.customer_id,r.revision'
   )).rows;
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
  let sent=0,failed=0;
  for(const job of jobs){
   const eligible=(await pool.query(
    'SELECT u.email FROM blofy_store_customer_carts c '+
    'JOIN blofy_store_customers u ON u.id=c.customer_id '+
    'WHERE c.customer_id=$1 AND c.revision=$2 AND u.marketing_opt_in=TRUE '+
    "AND c.updated_at<NOW()-INTERVAL '24 hours' "+
    "AND c.updated_at>NOW()-INTERVAL '14 days' "+
    "AND jsonb_typeof(c.items)='array' AND jsonb_array_length(c.items)>0 "+
    "AND NOT EXISTS(SELECT 1 FROM blofy_store_customer_orders co "+
    "JOIN blofy_store_geidea_orders o ON o.id=co.order_id "+
    "WHERE co.customer_id=c.customer_id AND o.status='paid' AND o.created_at>=c.updated_at)",
    [job.customer_id,job.revision])).rows[0];
   if(!eligible)continue;
   try{
    await deliver(eligible.email,job);
    await pool.query('UPDATE blofy_store_cart_recovery_emails '+
      'SET sent_at=NOW(),lease_until=NULL WHERE customer_id=$1 AND revision=$2',
      [job.customer_id,job.revision]);
    sent++;
   }catch{failed++;}
  }
  return {enabled:true,ready:true,queued:inserted.rowCount||0,claimed:jobs.length,sent,failed};
 }
 function start(){
  if(!enabled)return false;
  const initial=setTimeout(()=>void run().catch(()=>{}),120000);initial.unref?.();
  const timer=setInterval(()=>void run().catch(()=>{}),30*60000);timer.unref?.();
  return true;
 }
 return {enabled,run,start};
}

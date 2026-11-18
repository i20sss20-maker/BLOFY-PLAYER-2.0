// Paid, one-voucher renewal. Reuse the exact original code & Xtream account.
// No renewal is granted from a browser redirect, session ID, or manual "paid" flag.
import crypto from 'node:crypto';
import {paidOwnerVoucherSelect,renewalPlanFor,renewalStartAndExpiry} from './store-same-code-renewal.mjs';
import {decryptStreamCode} from './xtream-code-vault.mjs';
import {streamCodeProof} from './xtream-duration-codes.mjs';
import {publicOrderNumber} from './store-cart.mjs';
import {createSignature,CARD_ONLY_WALLETS} from './geidea-live.mjs';

export const RENEWAL_SKU='renewal';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err=(code,status=400)=>Object.assign(new Error(code),{status});
const accessHash=s=>crypto.createHash('sha256').update(s).digest('hex');

export function createStoreRenewalFlow({pool,json,readJson,keyHex,enabled,
 requireCheckoutCustomer,browser,rateCheckout,requestClientKey,
 schema,provider,plans,publicKey,password,base}){
 const available=()=>enabled===true;
 function verifyVoucher(row){
  if(!row?.code_vault||!row.code_hash)return false;
  try{
   const code=decryptStreamCode(row.voucher_id||row.id,row.code_vault,keyHex);
   return !!code&&streamCodeProof(code,keyHex)===row.code_hash;
  }catch{return false;}
 }
 async function owned(db,customerId,voucherId){
  return (await db.query(paidOwnerVoucherSelect(),[customerId,voucherId])).rows[0]||null;
 }
 async function pendingRow(db,customerId,voucherId){
  return (await db.query(
   'SELECT o.id,o.public_order_number,o.session_id,o.session_expires_at,o.created_at '+
   'FROM blofy_store_customer_orders m '+
   'JOIN blofy_store_renewal_orders r ON r.order_id=m.order_id '+
   'JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
   "WHERE m.customer_id=$1 AND r.voucher_id=$2 AND o.status='pending' "+
   'ORDER BY o.created_at DESC LIMIT 1',[customerId,voucherId])).rows[0]||null;
 }
 function publicPending(row){
  if(!row)return {ok:true,pending:false};
  const deadline=new Date(row.session_expires_at).getTime();
  const usable=UUID.test(row.session_id||'')&&
    Number.isFinite(deadline)&&deadline>Date.now()+15000;
  return {ok:true,pending:true,orderId:row.id,
   orderNumber:row.public_order_number||publicOrderNumber(row.id,row.created_at),
   sessionId:usable?row.session_id:null,
   sessionExpiresAt:usable?new Date(deadline).toISOString():null};
 }
 async function getPending(req,res){
  if(!available())return json(res,503,{error:'store_renewal_disabled'});
  if(!browser(req,res))return;
  const customer=await requireCheckoutCustomer(req);
  if(!customer?.ok)return json(res,customer?.status||401,
    {error:customer?.error||'customer_login_required'});
  if(!rateCheckout.consume(requestClientKey(req)).allowed)
    return json(res,429,{error:'rate_limited'});
  const body=await readJson(req);
  if(!UUID.test(body?.voucherId||''))return json(res,400,{error:'store_invalid_voucher'});
  await schema();
  const row=await owned(pool,customer.customerId,body.voucherId);
  if(!row)return json(res,404,{error:'store_voucher_not_owned'});
  return json(res,200,publicPending(await pendingRow(pool,customer.customerId,body.voucherId)));
 }
 async function checkout(req,res){
  if(!available())return json(res,503,{error:'store_renewal_disabled'});
  if(!browser(req,res))return;
  const customer=await requireCheckoutCustomer(req);
  if(!customer?.ok)return json(res,customer?.status||401,
    {error:customer?.error||'customer_login_required'});
  if(!rateCheckout.consume(requestClientKey(req)).allowed)
    return json(res,429,{error:'rate_limited'});
  const body=await readJson(req);
  if(!UUID.test(customer.customerId||'')||!UUID.test(body?.voucherId||'')||
     typeof body.planSku!=='string')return json(res,400,{error:'store_invalid_renewal'});
  await schema();
  const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
  let plan,number=publicOrderNumber(id);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   // The voucher row lock serializes checkout creation for this exact code
   // across browser tabs, customers and production replicas.
   await db.query('SELECT id FROM blofy_xtream_gateway_duration_codes WHERE id=$1 FOR UPDATE',
     [body.voucherId]);
   const row=await owned(db,customer.customerId,body.voucherId);
   if(!row){await db.query('ROLLBACK');return json(res,404,{error:'store_voucher_not_owned'});}
   plan=renewalPlanFor(body.planSku,row.code_channel,plans());
   if(!plan){await db.query('ROLLBACK');return json(res,400,{error:'store_invalid_renewal_plan'});}
   if(!renewalStartAndExpiry(row,plan.durationDays)||!verifyVoucher(row)){
    await db.query('ROLLBACK');
    return json(res,409,{error:'store_renewal_not_eligible'});
   }
   if(await pendingRow(db,customer.customerId,body.voucherId)){
    await db.query('ROLLBACK');
    return json(res,409,{error:'store_renewal_pending'});
   }
   await db.query('INSERT INTO blofy_store_geidea_orders '+
    '(id,sku,channel,duration_days,amount_minor,access_hash,public_order_number) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id,RENEWAL_SKU,plan.channel,plan.durationDays,plan.priceMinor,accessHash(token),number]);
   await db.query('INSERT INTO blofy_store_customer_orders(order_id,customer_id) VALUES($1,$2)',
    [id,customer.customerId]);
   await db.query('INSERT INTO blofy_store_renewal_orders '+
    '(order_id,voucher_id,plan_sku) VALUES($1,$2,$3)',[id,body.voucherId,plan.sku]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
  // Match the existing card-only Geidea checkout and use its official
  // server-validated callback. No card information is handled by BLOFY.
  const timestamp=new Date().toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
  const request={
   amount:(plan.priceMinor/100).toFixed(2),currency:'SAR',timestamp,merchantReferenceId:id,
   signature:createSignature({publicKey,password,amountMinor:plan.priceMinor,reference:id,timestamp}),
   paymentOperation:'Pay',language:'ar',hideWallets:[...CARD_ONLY_WALLETS],
   expressCheckouts:[],acceptTabbyPaymentMethod:false,acceptTamaraPaymentMethod:false,
   appearance:{uiMode:'modal'},
   callbackUrl:base+'/api/v1/store/geidea/webhook',
   returnUrl:base+'/api/v1/store/geidea/return?reference='+id
  };
  let created;
  try{created=await provider('/payment-intent/api/v2/direct/session','POST',request);}
  catch{
   // An HTTP failure might mean Geidea did create a session. Keep the
   // pending order locked until provider status can be verified; no blind retry.
   return json(res,503,{error:'store_renewal_provider_unconfirmed',orderNumber:number});
  }
  if(!UUID.test(created?.session?.id||'')||
     Date.parse(created?.session?.expiryDate||'')<=Date.now())
   return json(res,502,{error:'store_renewal_session_unconfirmed',orderNumber:number});
  await pool.query(
   'UPDATE blofy_store_geidea_orders SET session_id=$2,session_expires_at=$3 WHERE id=$1',
   [id,created.session.id,created.session.expiryDate]);
  return json(res,201,{provider:'geidea',checkoutMode:'redirect',sku:RENEWAL_SKU,
   orderId:id,orderNumber:number,voucherId:body.voucherId,
   sessionId:created.session.id,sessionExpiresAt:created.session.expiryDate,
   priceMinor:plan.priceMinor,currency:'SAR'});
 }
 // Called only WITHIN official Geidea verifiedPayment() and the existing
 // SELECT order FOR UPDATE transaction. A webhook replay sees status=paid.
 async function fulfill(db,order,settled){
  const renewal=(await db.query(
   'SELECT voucher_id,plan_sku FROM blofy_store_renewal_orders WHERE order_id=$1',
   [order.id])).rows[0];
  const plan=renewalPlanFor(renewal?.plan_sku,order.channel,plans());
  if(!renewal||!plan||plan.durationDays!==Number(order.duration_days)||
     plan.priceMinor!==Number(order.amount_minor)||
     Number(order.coupon_discount_minor||0)!==0||order.coupon_code)
   throw err('store_renewal_quote_mismatch',409);
  const code=(await db.query(
   'SELECT id AS voucher_id,code_channel,code_hash,code_vault,revoked_at,'+
   'redeemed_at,account_id,expires_at FROM blofy_xtream_gateway_duration_codes '+
   'WHERE id=$1 FOR UPDATE',[renewal.voucher_id])).rows[0];
  if(!code||!code.account_id)throw err('store_renewal_code_missing',409);
  const account=(await db.query(
   'SELECT id,enabled AS account_enabled,expires_at AS account_expires_at '+
   'FROM blofy_xtream_gateway_accounts WHERE id=$1 FOR UPDATE',
   [code.account_id])).rows[0];
  const preview=renewalStartAndExpiry({...code,...account},
   Number(order.duration_days));
  if(!preview||!verifyVoucher(code))throw err('store_renewal_code_changed',409);
  const next=new Date(preview.expiresAt);
  const updateAccount=await db.query(
   'UPDATE blofy_xtream_gateway_accounts SET expires_at=$2,updated_at=NOW() WHERE id=$1',
   [account.id,next]);
  if(updateAccount.rowCount!==1)throw err('store_renewal_account_update_failed',503);
  const updated=await db.query(
   'UPDATE blofy_xtream_gateway_duration_codes SET expires_at=$2,'+
   'extended_days=COALESCE(extended_days,0)+$3 WHERE id=$1',
   [renewal.voucher_id,next,order.duration_days]);
  if(updated.rowCount!==1)throw err('store_renewal_code_update_failed',503);
  await db.query('INSERT INTO blofy_xtream_gateway_code_events '+
   '(id,code_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)',
   [crypto.randomUUID(),renewal.voucher_id,'paid_same_code_renewal',
    JSON.stringify({orderId:order.id,days:order.duration_days,
      expiresAt:preview.expiresAt,oneTime:true})]);
  await db.query(
   "UPDATE blofy_store_geidea_orders SET status='paid',provider_reference=$2,"+
   'paid_at=NOW(),updated_at=NOW() WHERE id=$1',
   [order.id,settled.orderId]);
  return true;
 }
 return {checkout,getPending,fulfill};
}

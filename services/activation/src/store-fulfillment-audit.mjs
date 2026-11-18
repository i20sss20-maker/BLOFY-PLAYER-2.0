// Owner-only BLOFY payment-fulfillment audit. All code/vault data stays on the server.
// A simulated CI payment or a successful provider session is NOT evidence of a
// real bank charge. This checks the persisted paid-order code delivery contract.
import {cartVouchers} from './store-cart.mjs';
import {decryptStreamCode} from './xtream-code-vault.mjs';
import {streamCodeProof} from './xtream-duration-codes.mjs';

const MAX_PAID=500;
const AUDIT_DAYS=90;
const keyOf=id=>String(id);
function validVoucher(row,keyHex){
 if(!row?.id||!row.code_vault||!row.code_hash||row.revoked_at)return false;
 try{
  const code=decryptStreamCode(row.id,row.code_vault,keyHex);
  return !!code&&streamCodeProof(code,keyHex)===row.code_hash;
 }catch{return false;}
}
export function assessPaidOrder(order,vouchers,keyHex){
 let expected;
 if(order.sku==='cart')expected=cartVouchers(order.cart_items);
 else if(order.sku==='bundle-2y'){
  const channels=order.bundle_selection;
  expected=Array.isArray(channels)&&channels.length===2&&
    channels.every(c=>c==='app'||c==='xtream')
    ?channels.map(channel=>({sku:channel==='app'?'stream-1y':'xtream-1y',
      channel,durationDays:365})):null;
 }else expected=order.voucher_id?[{
  sku:order.sku,channel:order.channel,durationDays:Number(order.duration_days)}]:null;
 const rows=Array.isArray(vouchers)?vouchers:[];
 const expectedCount=expected?.length||0,deliveredCount=rows.length;
 let reason=null;
 if(!expected||expectedCount<1||expectedCount>6)reason='invalid_paid_order';
 else if(deliveredCount!==expectedCount)reason='code_count_mismatch';
 else if(rows.some((r,i)=>Number(r.position)!==i+1))
  reason='code_position_mismatch';
 else if(rows.some((r,i)=>r.sku!==expected[i].sku))
  reason='code_product_mismatch';
 else if(rows.some((r,i)=>r.channel!==expected[i].channel))
  reason='code_channel_mismatch';
 else if(rows.some((r,i)=>Number(r.duration_days)!==expected[i].durationDays))
  reason='code_duration_mismatch';
 else if(rows.some(r=>!validVoucher(r,keyHex)))reason='code_integrity_or_revocation';
 return {ok:reason===null,reason,expectedCodes:expectedCount,deliveredCodes:deliveredCount};
}
export async function auditPaidFulfillment({pool,keyHex}){
 const result=await pool.query(
  "SELECT id,sku,channel,duration_days,cart_items,bundle_selection,voucher_id,"+
  "created_at,public_order_number FROM blofy_store_geidea_orders "+
  "WHERE status='paid' AND created_at>=NOW()-INTERVAL '90 days' "+
  'ORDER BY created_at DESC LIMIT '+(MAX_PAID+1));
 const paid=result.rows||[],truncated=paid.length>MAX_PAID,orders=paid.slice(0,MAX_PAID);
 const carts=orders.filter(o=>o.sku==='cart').map(o=>o.id);
 const bundles=orders.filter(o=>o.sku==='bundle-2y').map(o=>o.id);
 const direct=orders.filter(o=>o.sku!=='cart'&&o.sku!=='bundle-2y'&&o.voucher_id);
 const rows=new Map(orders.map(o=>[keyOf(o.id),[]]));
 if(carts.length){
  const r=await pool.query(
   'SELECT cv.order_id,cv.position,cv.sku,cv.channel,cv.duration_days,'+
   'v.id,v.code_hash,v.code_vault,v.revoked_at FROM blofy_store_cart_vouchers cv '+
   'LEFT JOIN blofy_xtream_gateway_duration_codes v ON v.id=cv.voucher_id '+
   'WHERE cv.order_id=ANY($1::uuid[]) ORDER BY cv.order_id,cv.position',[carts]);
  for(const v of r.rows||[])rows.get(keyOf(v.order_id))?.push(v);
 }
 if(bundles.length){
  const r=await pool.query(
   'SELECT ov.order_id,ov.position,'+
   "CASE WHEN ov.channel='app' THEN 'stream-1y' ELSE 'xtream-1y' END AS sku,"+
   'ov.channel,ov.duration_days,v.id,v.code_hash,v.code_vault,v.revoked_at '+
   'FROM blofy_store_order_vouchers ov '+
   'LEFT JOIN blofy_xtream_gateway_duration_codes v ON v.id=ov.voucher_id '+
   'WHERE ov.order_id=ANY($1::uuid[]) ORDER BY ov.order_id,ov.position',[bundles]);
  for(const v of r.rows||[])rows.get(keyOf(v.order_id))?.push(v);
 }
 if(direct.length){
  const vouchers=(await pool.query(
   'SELECT id,code_channel AS channel,duration_days,code_hash,code_vault,revoked_at '+
   'FROM blofy_xtream_gateway_duration_codes WHERE id=ANY($1::uuid[])',
   [direct.map(o=>o.voucher_id)])).rows||[];
  const byId=new Map(vouchers.map(v=>[keyOf(v.id),v]));
  for(const o of direct){
   const v=byId.get(keyOf(o.voucher_id));
   if(v)rows.get(keyOf(o.id)).push({...v,sku:o.sku,position:1});
  }
 }
 let complete=0,broken=0;
 const issues=[];
 for(const o of orders){
  const assessed=assessPaidOrder(o,rows.get(keyOf(o.id)),keyHex);
  if(assessed.ok)complete++;
  else{
   broken++;
   if(issues.length<20)issues.push({
    orderNumber:o.public_order_number||null,orderId:o.id,sku:o.sku,
    reason:assessed.reason,expectedCodes:assessed.expectedCodes,
    deliveredCodes:assessed.deliveredCodes});
  }
 }
 return {ok:true,periodDays:AUDIT_DAYS,auditedOrders:orders.length,
   completeOrders:complete,issueOrders:broken,truncated,issues,
   scope:'last_90_days_latest_500_paid_orders',
   definition:'paid_order_vault_and_code_integrity_checked_not_bank_settlement'};
}

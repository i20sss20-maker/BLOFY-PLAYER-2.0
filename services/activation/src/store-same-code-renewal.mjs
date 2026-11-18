// BLOFY STORE renewals: explicitly verified ownership of an already PURCHASED
// and REDEEMED voucher, never a new account or replacement voucher.
export const RENEWAL_SKU='renewal';

// A guest can claim an earlier paid order only with its long bearer recovery token.
// The customer session then proves ownership here without sending raw voucher codes.
export const PAID_OWNED_VOUCHERS_SQL=
 "SELECT o.voucher_id AS voucher_id FROM blofy_store_customer_orders m "+
 "JOIN blofy_store_geidea_orders o ON o.id=m.order_id "+
 "WHERE m.customer_id=$1 AND o.status='paid' AND o.sku NOT IN ('renewal','cart','bundle-2y') AND o.voucher_id IS NOT NULL "+
 "UNION ALL SELECT cv.voucher_id FROM blofy_store_customer_orders m "+
 "JOIN blofy_store_geidea_orders o ON o.id=m.order_id "+
 "JOIN blofy_store_cart_vouchers cv ON cv.order_id=o.id "+
 "WHERE m.customer_id=$1 AND o.status='paid' AND o.sku='cart' "+
 "UNION ALL SELECT ov.voucher_id FROM blofy_store_customer_orders m "+
 "JOIN blofy_store_geidea_orders o ON o.id=m.order_id "+
 "JOIN blofy_store_order_vouchers ov ON ov.order_id=o.id "+
 "WHERE m.customer_id=$1 AND o.status='paid' AND o.sku='bundle-2y'";

export function paidOwnerVoucherSelect(extra=false){
 return 'SELECT v.id AS voucher_id,v.code_channel,v.code_hint,v.redeemed_at,'+
  'v.expires_at,v.revoked_at,v.account_id,v.code_vault,v.code_hash,'+
  'a.expires_at AS account_expires_at,a.enabled AS account_enabled'+
  (extra?',v.extended_days':'')+' FROM blofy_xtream_gateway_duration_codes v '+
  'LEFT JOIN blofy_xtream_gateway_accounts a ON a.id=v.account_id '+
  'WHERE v.id=$2 AND EXISTS (SELECT 1 FROM ('+PAID_OWNED_VOUCHERS_SQL+
  ') owned WHERE owned.voucher_id=v.id) LIMIT 1';
}

const DAY=86400000;
export function renewalStartAndExpiry(row,days,now=Date.now()){
 if(![90,180,365].includes(days))return null;
 if(!row||row.revoked_at||!row.redeemed_at||!row.account_id||
    row.account_enabled!==true||!row.code_vault||
    !['app','xtream'].includes(row.code_channel))return null;
 const codeTime=new Date(row.expires_at).getTime();
 const accountTime=new Date(row.account_expires_at).getTime();
 if(!Number.isFinite(codeTime)||!Number.isFinite(accountTime)||
    !Number.isFinite(now))return null;
 const start=Math.max(now,codeTime,accountTime);
 const expiry=start+days*DAY;
 return Number.isFinite(expiry)&&Number.isFinite(new Date(expiry).getTime())
  ?{days,startsAt:new Date(start).toISOString(),expiresAt:new Date(expiry).toISOString()}:null;
}

export function renewalPlanFor(sku,channel,plans){
 if(typeof sku!=='string')return null;
 const plan=plans.find(p=>p.sku===sku&&p.channel===channel&&
   [90,180,365].includes(p.durationDays)&&p.currency==='SAR');
 if(!plan||!Number.isSafeInteger(plan.priceMinor)||plan.priceMinor<=0)return null;
 return plan;
}

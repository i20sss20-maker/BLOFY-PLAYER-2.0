// Explicit, opt-in payment session readiness probe.
// Creates a 10.00 SAR UNPAID Geidea session. It never processes or captures a card,
// never stores a customer or order, and never reveals merchant credentials or session ids.
import crypto from 'node:crypto';
const pk=String(process.env.GEIDEA_LIVE_MERCHANT_PUBLIC_KEY||'').trim();
const secret=String(process.env.GEIDEA_LIVE_API_PASSWORD||'').trim();
const good=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const msg=v=>String(v||'').replace(/[A-Za-z0-9_\-+/=]{32,}/g,'[REDACTED]').slice(0,180);
if(process.env.BLOFY_GEIDEA_PREFLIGHT_ON_START==='true'){
  if(!good.test(pk)||secret.length<16) {
    console.error('[geidea-preflight]',JSON.stringify({status:'credentials_missing_or_invalid'}));
  }else{
    const ref=crypto.randomUUID();
    const timestamp=new Date().toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
    const signed=pk+'10.00'+'SAR'+ref+timestamp;
    const basePayload={
      amount:'10.00',currency:'SAR',timestamp,merchantReferenceId:ref,
      signature:crypto.createHmac('sha256',secret).update(signed,'utf8').digest('base64'),
      paymentOperation:'Pay',language:'ar',initiatedBy:'Internet',
      callbackUrl:'https://blofyplayer.com/api/v1/payments/geidea/webhook',
      returnUrl:'https://blofyplayer.com/pay',
      expressCheckouts:[],acceptTabbyPaymentMethod:false,acceptTamaraPaymentMethod:false,
      appearance:{uiMode:'modal'}
    };
    // Geidea returns code 110/112 when asked to hide a wallet that is not enabled
    // on the merchant. Probe the strongest available card-only setting first.
    const variants=[
      {name:'apple-and-samsung-hidden',hideWallets:['apple-pay','samsung-pay']},
      {name:'apple-hidden',hideWallets:['apple-pay']},
      {name:'merchant-disabled-wallets',hideWallets:null}
    ];
    for(const candidate of variants){
      const order=crypto.randomUUID(),time=new Date().toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
      const payload={...basePayload,merchantReferenceId:order,timestamp:time,
        signature:crypto.createHmac('sha256',secret).update(pk+'10.00SAR'+order+time).digest('base64')};
      if(candidate.hideWallets) payload.hideWallets=candidate.hideWallets;
      try{
        const res=await fetch('https://api.ksamerchant.geidea.net/payment-intent/api/v2/direct/session',{
          method:'POST',headers:{authorization:'Basic '+Buffer.from(pk+':'+secret).toString('base64'),
          accept:'application/json','content-type':'application/json'},
          body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),redirect:'error'
        });
        let data={};try{data=await res.json()}catch{}
        const ok=res.ok && data.responseCode==='000' && good.test(String(data.session?.id||''));
        console.info('[geidea-preflight]',JSON.stringify({
          variant:candidate.name,httpStatus:res.status,
          responseCode:msg(data?.responseCode),detailedResponseCode:msg(data?.detailedResponseCode),
          responseMessage:msg(data?.responseMessage),detailedResponseMessage:msg(data?.detailedResponseMessage),
          hasSession:good.test(String(data?.session?.id||'')),accepted:ok
        }));
        if(ok)break;
      }catch(e){
        console.error('[geidea-preflight]',JSON.stringify({
          variant:candidate.name,status:'network_error',name:msg(e?.name),code:msg(e?.cause?.code)
        }));
        break;
      }
    }
  }
}

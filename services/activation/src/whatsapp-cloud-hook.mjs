/* BLOFY WhatsApp Cloud API integration, default DISABLED.
 * Reacts only to text messages that the customer initiated via the official
 * Meta webhook. No unsolicited promotions or automatic issuance.
 * Neither customer phone numbers nor text bodies are persisted or logged.
 */
import crypto from 'node:crypto';

const ROUTE='/api/v1/whatsapp/cloud/webhook';
const ADMIN='/api/v1/admin/whatsapp/cloud/status';
const PHONE=/^\d{8,15}$/;
const MESSAGE_ID=/^[A-Za-z0-9._=:-]{8,250}$/;
const GRAPH_VERSION=/^v\d{1,2}\.\d{1,2}$/;
const LANG_DIGITS=Object.freeze({
  '١':'1','٢':'2','٣':'3','٤':'4','٥':'5',
  '۱':'1','۲':'2','۳':'3','۴':'4','۵':'5'
});
const safeJson=(res,code,payload)=>{
  const body=JSON.stringify(payload);
  res.writeHead(code,{
    'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'
  });
  res.end(body);
};
function equalConstant(a,b){
  const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
export function whatsappCloudConfig(env=process.env){
  const enabled=env.BLOFY_WA_CLOUD_ENABLED==='true';
  const appSecret=String(env.BLOFY_WA_CLOUD_APP_SECRET||'');
  const verifyToken=String(env.BLOFY_WA_CLOUD_VERIFY_TOKEN||'');
  const accessToken=String(env.BLOFY_WA_CLOUD_ACCESS_TOKEN||'');
  const phoneId=String(env.BLOFY_WA_CLOUD_PHONE_NUMBER_ID||'');
  const version=String(env.BLOFY_WA_CLOUD_GRAPH_VERSION||'v24.0');
  const configured=enabled&&appSecret.length>=32&&verifyToken.length>=20&&
    accessToken.length>=24&&/^\d{5,30}$/.test(phoneId)&&
    GRAPH_VERSION.test(version);
  return {enabled,configured,appSecret,verifyToken,accessToken,phoneId,version};
}
export function verifyWhatsAppSignature(raw,signature,secret){
  if(!Buffer.isBuffer(raw)||raw.length>128*1024||raw.length===0||
    typeof secret!=='string'||secret.length<32||
    typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  const proof='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');
  return equalConstant(signature,proof);
}
export function whatsappMenuReply(raw){
  if(typeof raw!=='string')return null;
  const value=raw.trim().slice(0,120).replace(/[١٢٣٤٥۱۲۳۴۵]/g,x=>LANG_DIGITS[x]||x);
  const code=value.toLowerCase();
  const welcome='أهلًا بك في BLOFY 👋\n\nاختر رقم الخدمة:\n' +
    '1️⃣ الاشتراكات والأسعار\n2️⃣ تحميل التطبيق\n' +
    '3️⃣ متابعة عملية دفع أو كود\n4️⃣ الدعم الفني\n5️⃣ التواصل مع الدعم\n\n' +
    'لا ترسل كلمات مرور أو بيانات بطاقات الدفع.';
  if(['','0','hi','hello','menu','start','مرحبا','هلا','السلام عليكم','قائمة','القائمة','مساعدة'].includes(code))
    return welcome;
  if(code==='1'||code==='اشتراكات'||code==='الاشتراكات')
    return 'اشتراكات BLOFY وأسعار الباقات والعروض المباشرة من المتجر:\nhttps://blofyplayer.com/#products\n\nللدفع استخدم بوابة المتجر الرسمية فقط.';
  if(code==='2'||code==='تحميل'||code==='التطبيق')
    return 'تحميل تطبيقات BLOFY والتحديثات من الموقع الرسمي:\nhttps://updates.blofyplayer.com/downloads\n\nاختر التطبيق المتوافق مع جهازك.';
  if(code==='3'||code==='طلب'||code==='كود'||code==='الدفع')
    return 'لمتابعة عملية الدفع، افتح صفحة طلبك الأصلية واضغط «التحقق مرة أخرى». لا تُكرر الدفع قبل ظهور حالته.\nhttps://blofyplayer.com/\n\nلا تشارك كودك أو تفاصيل البطاقة في المحادثة.';
  if(code==='4'||code==='دعم'||code==='مشكلة')
    return 'للمساعدة الفنية، راجع مركز الدعم الرسمي:\nhttps://blofyplayer.com/support\n\nاذكر نوع الجهاز ورسالة الخطأ فقط؛ لا ترسل كود الاشتراك.';
  if(code==='5'||code==='موظف')
    return 'للتواصل مع فريق BLOFY، استخدم صفحة التواصل الرسمية:\nhttps://blofyplayer.com/store/contact\n\nهذه الرسالة آلية، ولا تعني فتح تذكرة دعم.';
  return welcome;
}
async function readRaw(req,max=128*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>max)throw Object.assign(Error('webhook_payload_too_large'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function parseWhatsAppInbound(body,phoneId){
  if(!body||body.object!=='whatsapp_business_account'||!Array.isArray(body.entry))
    return [];
  const messages=[];
  for(const entry of body.entry.slice(0,3)){
    if(!Array.isArray(entry?.changes))continue;
    for(const change of entry.changes.slice(0,3)){
      if(change.field!=='messages'||String(change.value?.metadata?.phone_number_id||'')!==phoneId)continue;
      for(const item of (Array.isArray(change.value?.messages)?change.value.messages:[]).slice(0,5)){
        if(item?.type!=='text'||!MESSAGE_ID.test(String(item.id||''))||
          !PHONE.test(String(item.from||''))||typeof item.text?.body!=='string')
          continue;
        const reply=whatsappMenuReply(item.text.body);
        if(reply)messages.push({id:item.id,to:item.from,reply});
        if(messages.length>=5)return messages;
      }
    }
  }
  return messages;
}
export function createWhatsAppCloudHandlers({
  pool,authorizeAdmin=()=>false,env=process.env,fetchImpl=fetch,
  logger=console
}={}){
  if(!pool||typeof pool.query!=='function'||typeof fetchImpl!=='function')
    throw Error('whatsapp_cloud_dependencies_invalid');
  const cfg=whatsappCloudConfig(env);
  let ready=null;
  async function schema(){
    if(!ready)ready=(async()=>{
      const db=await pool.connect();
      try{
        await db.query('BEGIN');
        await db.query('SELECT pg_advisory_xact_lock(718420735)');
        await db.query("CREATE TABLE IF NOT EXISTS blofy_whatsapp_cloud_receipts ("+
          "proof CHAR(64) PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('processing','sent','failed')),"+
          "attempts SMALLINT NOT NULL DEFAULT 1,received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
          "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
        await db.query('COMMIT');
      }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
      finally{db.release();}
    })().catch(error=>{ready=null;throw error;});
    return ready;
  }
  function messageProof(id){
    return crypto.createHmac('sha256',cfg.appSecret)
      .update('BLOFY-WA-RECEIPT-v1:').update(id).digest('hex');
  }
  async function claim(id){
    const proof=messageProof(id);
    const inserted=await pool.query(
      "INSERT INTO blofy_whatsapp_cloud_receipts(proof,status) VALUES($1,'processing') "+
      'ON CONFLICT DO NOTHING RETURNING proof',[proof]);
    if(inserted.rowCount===1)return proof;
    // Meta may redeliver an event. A failed request can be retried at
    // most twice; pending and successfully sent receipts never re-send.
    const resumed=await pool.query(
      "UPDATE blofy_whatsapp_cloud_receipts SET status='processing',"+
      "attempts=attempts+1,updated_at=NOW() WHERE proof=$1 AND status='failed'"+
      " AND attempts<3 AND updated_at<NOW()-INTERVAL '5 seconds' RETURNING proof",[proof]);
    if(resumed.rowCount===1)return proof;
    // If a worker crashed mid-send, a message can be retried after two
    // minutes. Concurrent workers remain protected by the atomic row update.
    const abandoned=await pool.query(
      "UPDATE blofy_whatsapp_cloud_receipts SET status='processing',"+
      "attempts=attempts+1,updated_at=NOW() WHERE proof=$1 AND status='processing'"+
      " AND attempts<3 AND updated_at<NOW()-INTERVAL '2 minutes' RETURNING proof",[proof]);
    return abandoned.rowCount===1?proof:null;
  }
  async function mark(proof,status){
    await pool.query('UPDATE blofy_whatsapp_cloud_receipts SET status=$2,updated_at=NOW() WHERE proof=$1',[proof,status]);
  }
  async function send({to,reply}){
    const response=await fetchImpl('https://graph.facebook.com/'+cfg.version+'/'+cfg.phoneId+'/messages',{
      method:'POST',redirect:'error',
      headers:{authorization:'Bearer '+cfg.accessToken,accept:'application/json',
        'content-type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',
        text:{preview_url:false,body:reply}}),
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw Error('provider_send_failed');
    // Meta's 2xx body must contain an accepted message id; no response
    // bytes or customer identifiers are logged or persisted.
    const data=await response.json().catch(()=>({}));
    if(!Array.isArray(data.messages)||typeof data.messages[0]?.id!=='string')
      throw Error('provider_response_invalid');
  }
  async function webhook(req,res,url){
    if(!cfg.configured)return safeJson(res,404,{error:'not_configured'});
    if(req.method==='GET'){
      const q=url.searchParams;
      const valid=q.get('hub.mode')==='subscribe'&&
        equalConstant(q.get('hub.verify_token'),cfg.verifyToken)&&
        /^\d{1,20}$/.test(String(q.get('hub.challenge')||''));
      if(!valid)return safeJson(res,403,{error:'verification_rejected'});
      const challenge=q.get('hub.challenge');
      res.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'});
      res.end(challenge);
      return;
    }
    if(req.method!=='POST')return safeJson(res,405,{error:'method_not_allowed'});
    const raw=await readRaw(req);
    if(!verifyWhatsAppSignature(raw,String(req.headers['x-hub-signature-256']||''),cfg.appSecret))
      return safeJson(res,403,{error:'signature_rejected'});
    let body;
    try{body=JSON.parse(raw.toString('utf8'));}
    catch{return safeJson(res,400,{error:'invalid_json'});}
    const messages=parseWhatsAppInbound(body,cfg.phoneId);
    if(!messages.length)return safeJson(res,200,{ok:true,ignored:true});
    await schema();
    let accepted=0,duplicate=0,failed=0;
    for(const message of messages){
      const proof=await claim(message.id);
      if(!proof){duplicate++;continue;}
      try{
        await send(message);
        await mark(proof,'sent');accepted++;
      }catch(error){
        failed++;
        await mark(proof,'failed').catch(()=>{});
        logger.warn?.('BLOFY_WA_CLOUD',JSON.stringify({code:'send_failed'}));
      }
    }
    if(failed)return safeJson(res,503,{ok:false,error:'delivery_retryable'});
    return safeJson(res,200,{ok:true,accepted,duplicate});
  }
  async function status(req,res){
    if(!authorizeAdmin(req,res))return;
    let counts=null;
    if(cfg.configured){
      try{
        await schema();
        const result=await pool.query(
          "SELECT COUNT(*) FILTER (WHERE status='sent')::int AS sent,"+
          "COUNT(*) FILTER (WHERE status='failed')::int AS failed FROM blofy_whatsapp_cloud_receipts "+
          "WHERE received_at>NOW()-INTERVAL '24 hours'");
        counts=result.rows?.[0]||null;
      }catch{}
    }
    return safeJson(res,200,{ok:true,provider:'meta_whatsapp_cloud',
      enabled:cfg.enabled,configured:cfg.configured,
      webhookSubscriptionVerified:false, // must be verified in Meta console
      mode:'inbound_replies_only',counts,
      note:'No automatic sales, unsolicited marketing, order delivery or customer outreach enabled.'});
  }
  return async function handle(req,res,url){
    if(url.pathname===ADMIN&&req.method==='GET'){await status(req,res);return true;}
    if(url.pathname===ROUTE){await webhook(req,res,url);return true;}
    return false;
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  whatsappCloudConfig,verifyWhatsAppSignature,whatsappMenuReply,
  parseWhatsAppInbound,createWhatsAppCloudHandlers
} from '../src/whatsapp-cloud-hook.mjs';

const APP_SECRET='s'.repeat(40);
const CONFIG={
  BLOFY_WA_CLOUD_ENABLED:'true',
  BLOFY_WA_CLOUD_APP_SECRET:APP_SECRET,
  BLOFY_WA_CLOUD_VERIFY_TOKEN:'v'.repeat(30),
  BLOFY_WA_CLOUD_ACCESS_TOKEN:'token'.repeat(12),
  BLOFY_WA_CLOUD_PHONE_NUMBER_ID:'12345678901234',
  BLOFY_WA_CLOUD_GRAPH_VERSION:'v24.0'
};
const incoming={object:'whatsapp_business_account',entry:[{
  changes:[{field:'messages',value:{
    metadata:{phone_number_id:CONFIG.BLOFY_WA_CLOUD_PHONE_NUMBER_ID},
    messages:[{id:'wamid.HBgNMTIzNDU2Nzg5MAA=',from:'966500000001',
      type:'text',text:{body:'١'}}]
  }}]
}]};
function request(method,path,raw,headers={}){
  return {method,url:path,headers,
    async *[Symbol.asyncIterator](){if(raw)yield Buffer.from(raw)}
  };
}
function response(){
  return {statusCode:null,body:null,headers:null,
    writeHead(status,headers){this.statusCode=status;this.headers=headers},
    end(data){this.body=data==null?'':String(data)}
  };
}
function fakePool(){
  const seen=new Set(),queries=[];
  const client={async query(sql,args){queries.push({sql,args});return {rows:[],rowCount:0}},
    release(){}};
  return {queries,
    async connect(){return client},
    async query(sql,args){
      queries.push({sql,args});
      if(sql.startsWith('INSERT INTO blofy_whatsapp_cloud_receipts')){
        const proof=args[0];
        if(seen.has(proof))return {rowCount:0,rows:[]};
        seen.add(proof);return {rowCount:1,rows:[{proof}]};
      }
      if(sql.startsWith('UPDATE blofy_whatsapp_cloud_receipts')){
        if(sql.includes("SET status=$2"))return {rowCount:1};
        return {rowCount:0};
      }
      return {rowCount:0,rows:[]};
    }
  };
}
test('Cloud API defaults OFF and rejects incomplete credentials',()=>{
  assert.equal(whatsappCloudConfig({}).configured,false);
  assert.equal(whatsappCloudConfig({}).enabled,false);
  assert.equal(whatsappCloudConfig({...CONFIG,BLOFY_WA_CLOUD_ACCESS_TOKEN:''}).configured,false);
  assert.equal(whatsappCloudConfig(CONFIG).configured,true);
});
test('Webhook HMAC SHA256 is validated against raw bytes and rejects forgeries',()=>{
  const bytes=Buffer.from(JSON.stringify(incoming));
  const header='sha256='+createHmac('sha256',APP_SECRET).update(bytes).digest('hex');
  assert.equal(verifyWhatsAppSignature(bytes,header,APP_SECRET),true);
  assert.equal(verifyWhatsAppSignature(bytes,header.slice(0,-2)+'aa',APP_SECRET),false);
  assert.equal(verifyWhatsAppSignature(bytes,'sha256=abc',APP_SECRET),false);
  assert.equal(verifyWhatsAppSignature(Buffer.alloc(128*1024+1),header,APP_SECRET),false);
});
test('WhatsApp menu supports Arabic numeric choices, never requests card data',()=>{
  const menu=whatsappMenuReply('هلا');
  for(const word of ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'])
    assert.ok(menu.includes(word));
  assert.match(whatsappMenuReply('١'),/blofyplayer\.com\/\#products/);
  assert.match(whatsappMenuReply('۲'),/updates\.blofyplayer\.com\/downloads/);
  assert.match(whatsappMenuReply('3'),/لا تُكرر الدفع/);
  assert.match(whatsappMenuReply('4'),/blofyplayer\.com\/support/);
  assert.match(whatsappMenuReply('5'),/لا تعني فتح تذكرة/);
  assert.doesNotMatch(menu,/ارسل رقم البطاقة|بطاقتك البنكية|كود التفعيل هنا/);
});
test('Message parsing restricts sender ID and recipient phone number ID',()=>{
  const out=parseWhatsAppInbound(incoming,CONFIG.BLOFY_WA_CLOUD_PHONE_NUMBER_ID);
  assert.equal(out.length,1);
  assert.equal(out[0].to,'966500000001');
  assert.equal(parseWhatsAppInbound(incoming,'999999').length,0);
  const statuses={object:'whatsapp_business_account',entry:[{changes:[{
    field:'messages',value:{metadata:{phone_number_id:CONFIG.BLOFY_WA_CLOUD_PHONE_NUMBER_ID},
      statuses:[{status:'read'}]}}]}]};
  assert.deepEqual(parseWhatsAppInbound(statuses,CONFIG.BLOFY_WA_CLOUD_PHONE_NUMBER_ID),[]);
});
test('Disabled endpoint cannot send or write even if someone calls webhook path',async()=>{
  const pool=fakePool();let sends=0;
  const handle=createWhatsAppCloudHandlers({
    pool,env:{},fetchImpl:async()=>{sends++},logger:{warn(){}}
  });
  const res=response();
  assert.equal(await handle(request('POST','/api/v1/whatsapp/cloud/webhook','anything'),res,
    new URL('https://blofyplayer.com/api/v1/whatsapp/cloud/webhook')),true);
  assert.equal(res.statusCode,404);
  assert.equal(sends,0);
  assert.equal(pool.queries.length,0);
});
test('Webhook verify challenge requires shared token, and signed reply deduplicates delivery',async()=>{
  const pool=fakePool();const sends=[];
  const handle=createWhatsAppCloudHandlers({
    pool,env:CONFIG,logger:{warn(){}},
    fetchImpl:async(url,options)=>{sends.push({url,options});return {
      ok:true,json:async()=>({messages:[{id:'wamid.outbound'}]})
    }}
  });
  const base='https://blofyplayer.com/api/v1/whatsapp/cloud/webhook';
  const good=response(),bad=response();
  const q=base+'?hub.mode=subscribe&hub.verify_token='+CONFIG.BLOFY_WA_CLOUD_VERIFY_TOKEN+'&hub.challenge=4321';
  await handle(request('GET',new URL(q).pathname),good,new URL(q));
  assert.equal(good.statusCode,200);
  assert.equal(good.body,'4321');
  await handle(request('GET',new URL(base).pathname),bad,new URL(base));
  assert.equal(bad.statusCode,403);
  const raw=JSON.stringify(incoming);
  const signature='sha256='+createHmac('sha256',APP_SECRET).update(raw).digest('hex');
  const url=new URL(base);
  const headers={'x-hub-signature-256':signature};
  const first=response();
  await handle(request('POST',url.pathname,raw,headers),first,url);
  assert.equal(first.statusCode,200);
  assert.equal(JSON.parse(first.body).accepted,1);
  assert.equal(sends.length,1);
  assert.equal(sends[0].url,'https://graph.facebook.com/v24.0/12345678901234/messages');
  const payload=JSON.parse(sends[0].options.body);
  assert.equal(payload.to,'966500000001');
  assert.equal(payload.messaging_product,'whatsapp');
  assert.equal(payload.text.preview_url,false);
  const repeat=response();
  await handle(request('POST',url.pathname,raw,headers),repeat,url);
  assert.equal(repeat.statusCode,200);
  assert.equal(JSON.parse(repeat.body).duplicate,1);
  assert.equal(sends.length,1,'replayed WhatsApp delivery must never send again');
  const forged=response();
  await handle(request('POST',url.pathname,raw,{'x-hub-signature-256':'sha256='+'a'.repeat(64)}),forged,url);
  assert.equal(forged.statusCode,403);
  assert.equal(sends.length,1);
  assert.ok(!JSON.stringify(pool.queries).includes('966500000001'));
  assert.ok(!JSON.stringify(pool.queries).includes('هلا'));
});
test('Production Cloud API route is opt-in, cannot issue codes or mutate purchase state',async()=>{
  const [hook,server,pack]=await Promise.all([
    readFile(new URL('../src/whatsapp-cloud-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/server.mjs',import.meta.url),'utf8'),
    readFile(new URL('../package.json',import.meta.url),'utf8')
  ]);
  assert.match(server,/createWhatsAppCloudHandlers\(\{pool,authorizeAdmin:requireAdmin\}\)/);
  assert.match(server,/if \(await whatsappCloud\(req,res,requestUrl\)\) return;/);
  assert.match(hook,/BLOFY_WA_CLOUD_ENABLED==='true'/);
  assert.match(hook,/authorization:'Bearer '\+cfg\.accessToken/);
  assert.match(hook,/CREATE TABLE IF NOT EXISTS blofy_whatsapp_cloud_receipts/);
  assert.match(hook,/messageProof\(id\)/);
  assert.match(pack,/node --check src\/whatsapp-cloud-hook\.mjs/);
  assert.doesNotMatch(hook,/localStorage|sendBulk|broadcast|storeCheckout|issueVoucher|automaticPayment/);
});

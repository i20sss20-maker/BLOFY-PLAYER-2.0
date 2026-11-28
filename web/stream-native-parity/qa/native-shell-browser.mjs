// End-to-end browser shell smoke test, using synthetic accounts only.
// No access to production, user data, source hosts, or real media.
import {chromium,webkit,devices} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/profile-transfer.js':'profile-transfer.js','/playback-acceptance.js':'playback-acceptance.js','/stream-icon.svg':'stream-icon.svg','/manifest.webmanifest':'manifest.webmanifest'};
const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname,file=files[path];
 if(!file){res.writeHead(404).end();return}
 res.setHeader('Content-Type',types[file.slice(file.lastIndexOf('.'))]||'application/octet-stream');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 const cases=process.env.BLOFY_QA_WEBKIT==='1'?[['chromium',chromium,'iPhone 13'],['webkit',webkit,'iPhone 13'],['webkit',webkit,'iPad Pro 11']]:[['chromium',chromium,'iPhone 13']];
 for(const [name,engine,device] of cases){
 browser=await engine.launch({headless:true,...(name==='chromium'&&process.env.BLOFY_QA_BUNDLED_CHROMIUM!=='1'?{channel:'chrome'}:{})});
 for(const mode of ['code','xtream','m3u']){
  const ctx=await browser.newContext({...devices[device],serviceWorkers:'block'});
  const page=await ctx.newPage(),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await ctx.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(u.origin!==origin)return route.abort();
   const p=u.pathname;
   if(!p.startsWith('/api/'))return route.continue();
   const respond=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(p==='/api/session')return respond(401,{active:false});
   if(p==='/api/login-modes')return respond(200,{direct:mode!=='code'});
   if(p==='/api/redeem'||p==='/api/direct-login'){
    const input=request.postDataJSON();requests.push({p,input});
    return respond(200,{ok:true,profileKey:'a'.repeat(24),expiresAt:Date.now()+3600000});
   }
   if(p==='/api/page')return respond(200,{items:[],total:0,hasMore:false,nextOffset:null});
   if(p==='/api/catalog')return respond(200,[]);
   if(p==='/api/ai/interpret')return respond(200,{ok:true,reply:'نتيجة اختبار محلية',suggestedTitles:['Fixture']});
   return respond(404,{error:'synthetic_route_not_configured'});
  });
  await page.goto(origin);
  await page.locator('#activation-code').waitFor();
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-blofy-device')==='touch');
  if(mode==='code'){
   await page.waitForFunction(()=>document.getElementById('login-mode-xtream').disabled);
   await page.locator('#activation-code').fill('12345678');
  }else{
   await page.waitForFunction(()=>!document.getElementById('login-mode-xtream').disabled);
   await page.locator('#login-mode-'+mode).click();
   if(mode==='xtream'){
    await page.locator('#provider-username').fill('fixture-user');
    await page.locator('#provider-password').fill('fixture-secret');
   }else await page.locator('#provider-url').fill('https://x.blofyplayer.com/get.php?username=fixture-user&password=fixture-secret');
  }
  await page.locator('#redeem').click();
  await page.locator('.native-home-header').waitFor();
  assert.equal(requests.length,1);assert.match(requests[0].input.deviceKey,/^[a-f0-9]{64}$/);
  assert.equal(requests[0].p,mode==='code'?'/api/redeem':'/api/direct-login');
  if(mode==='code')assert.equal(requests[0].input.code,'12345678');else assert.equal(requests[0].input.mode,mode);
  assert.equal(await page.locator('.native-home-bottom [data-go]').count(),4);
  const stored=await page.evaluate(()=>JSON.stringify(localStorage));
  assert.ok(!stored.includes('fixture-secret')&&!stored.includes('fixture-user')&&!stored.includes('12345678'));
  await page.locator('.native-home-bottom [data-go="downloads"]').click();
  await page.locator('.downloads-page').waitFor();
  assert.equal(await page.locator('.native-home-bottom [data-go]').count(),4);
  await page.locator('.native-home-bottom [data-go="home"]').click();
  await page.locator('.native-home-header').waitFor();
  await page.locator('.native-home-header [data-go="ai"]').click();
  assert.equal(await page.locator('.rail').count(),0);
  await page.locator('#ai-text').fill('اختبار');
  await page.locator('#ai-send').click();
  await page.getByText('نتيجة اختبار محلية',{exact:true}).waitFor();
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('BLOFY_NATIVE_SHELL_SYNTHETIC_PASS',name,device,mode);
  await ctx.close();
 }
 await browser.close();browser=null;
 }
 // TV-style user agent and 720p viewport; use only directional keys and Enter.
 browser=await chromium.launch({headless:true,...(process.env.BLOFY_QA_BUNDLED_CHROMIUM==='1'?{}:{channel:'chrome'})});
 const tv=await browser.newContext({viewport:{width:1280,height:720},userAgent:'Mozilla/5.0 (Linux; VIDAA; Toshiba SmartTV) AppleWebKit/537.36 Chrome/90.0.4430.0 Safari/537.36',serviceWorkers:'block'});
 const page=await tv.newPage();
 const failures=[];
 page.on('pageerror',e=>failures.push(e.message));
 await tv.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  const values={'/api/session':{active:false},'/api/login-modes':{direct:false},'/api/redeem':{ok:true,profileKey:'b'.repeat(24),expiresAt:Date.now()+3600000},'/api/page':{items:[],total:0,hasMore:false,nextOffset:null}};
  return route.fulfill({status:u.pathname==='/api/session'?401:200,contentType:'application/json',body:JSON.stringify(values[u.pathname]||[])});
 });
 await page.goto(origin);
 await page.waitForFunction(()=>document.documentElement.getAttribute('data-blofy-device')==='tv');
 await page.locator('#activation-code').waitFor();
 await page.waitForFunction(()=>document.activeElement.id==='activation-code');
 await page.keyboard.type('12345678');
 await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'redeem');
 await page.keyboard.press('Enter');
 await page.locator('.rail-link[data-go="home"]').waitFor();
 await page.locator('.rail-link[data-go="home"]').focus();
 await page.keyboard.press('ArrowDown');
 const next=await page.evaluate(()=>document.activeElement.getAttribute('data-go'));
 assert.ok(next&&next!=='home');
 await page.keyboard.press('Enter');
 await page.locator('[data-back]').first().waitFor();
 await page.keyboard.press('Escape');
 await page.locator('.rail-link[data-go="home"].active').waitFor();
 assert.deepEqual(failures,[]);
 console.log('BLOFY_TV_REMOTE_SYNTHETIC_PASS 720p directional keys, login, navigation and back');
 await tv.close();
}finally{await browser?.close();await new Promise(r=>server.close(r))}

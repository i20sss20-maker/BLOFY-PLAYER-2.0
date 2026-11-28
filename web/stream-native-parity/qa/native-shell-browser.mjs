// End-to-end browser shell smoke test, using synthetic accounts only.
// No access to production, user data, source hosts, or real media.
import {chromium,webkit,devices} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/profile-transfer.js':'profile-transfer.js','/playback-acceptance.js':'playback-acceptance.js','/stream-icon.svg':'stream-icon.svg','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js'};
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
   if(p==='/api/session')return requests.length?respond(200,{active:true,profileKey:'a'.repeat(24),expiresAt:Date.now()+3600000,daysRemaining:1}):respond(401,{active:false});
   if(p==='/api/login-modes')return respond(200,{direct:mode!=='code'});
   if(p==='/api/redeem'||p==='/api/direct-login'){
    const input=request.postDataJSON();requests.push({p,input});
    return respond(200,{ok:true,profileKey:'a'.repeat(24),expiresAt:Date.now()+3600000});
   }
   if(p==='/api/page'){
    const kind=u.searchParams.get('kind'),items=kind==='movie'?[{stream_id:123,name:'Fixture movie',container_extension:'mp4'}]:kind==='series'?[{series_id:321,name:'Fixture series'}]:kind==='live'?[{stream_id:456,name:'Fixture live'}]:[];
    return respond(200,{items,total:items.length,hasMore:false,nextOffset:null})
   }
   if(p==='/api/catalog'){
    const action=u.searchParams.get('action');
    if(action&&action.endsWith('_categories'))return respond(200,[{category_id:'1',category_name:'رياضة'},{category_id:'2',category_name:'دراما'}]);
    if(action==='get_series_info')return respond(200,{info:{plot:'وصف عربي'},episodes:{'1':[{id:'789',title:'Fixture series episode one',episode_num:1,container_extension:'mp4'}]}});
    if(action==='get_vod_info')return respond(200,{info:{plot:'وصف عربي للفيلم'}});
    return respond(200,[])
   }
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
  {const navBox=await page.locator('.native-home-bottom').boundingBox(),workspaceBox=await page.locator('.workspace').boundingBox();
  const narrow=await page.evaluate(()=>matchMedia('(max-width:600px) and (orientation:portrait)').matches);assert.ok(navBox&&workspaceBox&&(narrow?navBox.y>=workspaceBox.y+workspaceBox.height-2:navBox.x>=workspaceBox.x+workspaceBox.width-2),'responsive navigation must stay outside the content');}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'phone layout must not overflow horizontally');
  assert.equal(await page.locator('.native-home-bottom').locator('[data-go="downloads"] svg').count(),1);
  if(mode==='code'){
   // Populated screens: cover the real layout rather than only empty Home.
   await page.locator('.native-home-tabs [data-go="movie"]').click();
   await page.locator('.poster-grid [data-details="movie:123"]').waitFor();
   await page.locator('.category-filter-input').fill('دراما');
   assert.equal(await page.locator('.cat-item[data-cat="movie:1"]').isVisible(),false);
   assert.equal(await page.locator('.cat-item[data-cat="movie:2"]').isVisible(),true);
   await page.locator('.category-filter-input').fill('');
   await page.locator('.poster-grid [data-details="movie:123"]').click();
   await page.locator('#detail-plot-text').waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.locator('[data-back]').first().click();
   await page.locator('.catalog-home').click();
   await page.locator('.native-home-tabs [data-go="series"]').click();
   await page.locator('.poster-grid [data-details="series:321"]').click();
   await page.locator('[data-episodes="321"]').first().click();
   await page.locator('.episode-card [data-watch="series:789"]').waitFor();
   assert.equal(await page.locator('.episode-name').first().textContent(),'الحلقة 1');
   assert.ok(await page.locator('.episode-card [data-download="series:789"]').isVisible());
   await page.locator('[data-back]').first().click();
   await page.locator('[data-back]').first().click();
   await page.locator('.catalog-home').click();
   await page.locator('.native-home-tabs [data-go="live"]').click();
   await page.locator('[data-channel="456"]').waitFor();
   const phone=await page.evaluate(()=>matchMedia('(max-width:730px), (max-height:540px) and (orientation:landscape)').matches);
   if(phone)assert.equal(await page.locator('.preview').isVisible(),false);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.locator('.catalog-home').click();
   const vp=page.viewportSize();
   await page.setViewportSize({width:vp.height,height:vp.width});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.setViewportSize(vp);
   console.log('BLOFY_POPULATED_LAYOUT_PASS',name,device);
  }
  const stored=await page.evaluate(()=>JSON.stringify(localStorage));
  assert.ok(!stored.includes('fixture-secret')&&!stored.includes('fixture-user')&&!stored.includes('12345678'));
  await page.locator('.native-home-bottom [data-go="downloads"]').click();
  await page.locator('.downloads-page').waitFor();
  assert.equal(await page.locator('.native-home-bottom [data-go]').count(),4);
  {const navBox=await page.locator('.native-home-bottom').boundingBox(),workspaceBox=await page.locator('.workspace').boundingBox();
  const narrow=await page.evaluate(()=>matchMedia('(max-width:600px) and (orientation:portrait)').matches);assert.ok(navBox&&workspaceBox&&(narrow?navBox.y>=workspaceBox.y+workspaceBox.height-2:navBox.x>=workspaceBox.x+workspaceBox.width-2),'responsive navigation must stay outside the content');}
  await page.locator('.native-home-bottom [data-go="home"]').click();
  await page.locator('.native-home-header').waitFor();
  await page.locator('.native-home-header [data-go="settings"]').click();
  await page.locator('#subscription-status').click();
  await page.waitForFunction(()=>document.getElementById('subscription-feedback')?.textContent.includes('الاشتراك نشط'));
  assert.equal(await page.locator('#picture-fit-label').textContent(),'ملاءمة');
  await page.locator('#picture-fit').click();
  assert.equal(await page.locator('#picture-fit-label').textContent(),'تكبير');
  await page.locator('[data-back]').first().click();
  await page.locator('.native-home-header [data-go="settings"]').click();
  assert.equal(await page.locator('#picture-fit-label').textContent(),'تكبير');
  await page.locator('[data-back]').first().click();
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
 await tv.close();await browser.close();
 // Saved subscriptions: synthetic independent account identities, one active at a time.
 browser=await chromium.launch({headless:true,...(process.env.BLOFY_QA_BUNDLED_CHROMIUM==='1'?{}:{channel:'chrome'})});
 const accounts=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 const savedPage=await accounts.newPage(),savedErrors=[],savedModes=new Set(),loginCalls=[];
 const profiles={code:'d'.repeat(24),xtream:'e'.repeat(24),m3u:'f'.repeat(24)};
 let activeMode=null,failSwitch=false;
 savedPage.on('pageerror',e=>savedErrors.push(e.message));
 await accounts.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.origin!==origin)return route.abort();
  const p=u.pathname;
  if(!p.startsWith('/api/'))return route.continue();
  const respond=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  const session=()=>({ok:true,active:true,profileKey:profiles[activeMode],expiresAt:Date.now()+3600000,daysRemaining:1});
  if(p==='/api/session')return activeMode?respond(200,session()):respond(401,{active:false});
  if(p==='/api/login-modes')return respond(200,{direct:true,savedLogins:true});
  if(p==='/api/saved-logins')return respond(200,{active:activeMode,modes:[...savedModes]});
  if(p==='/api/redeem'||p==='/api/direct-login'){
   const input=request.postDataJSON();activeMode=p==='/api/redeem'?'code':input.mode;
   loginCalls.push(activeMode);savedModes.add(activeMode);return respond(200,session());
  }
  if(p==='/api/saved-logins/switch'){
   const mode=request.postDataJSON().mode;
   if(failSwitch)return respond(503,{error:'saved_session_unavailable'});
   if(!savedModes.has(mode))return respond(404,{error:'saved_login_missing'});
   activeMode=mode;return respond(200,session());
  }
  if(p==='/api/logout'){activeMode=null;savedModes.clear();return respond(200,{ok:true})}
  if(p==='/api/page')return respond(200,{items:[],total:0,hasMore:false,nextOffset:null});
  if(p==='/api/catalog')return respond(200,[]);
  return respond(404,{error:'synthetic_route_not_configured'});
 });
 const savedHome=()=>savedPage.locator('.native-home-header').waitFor();
 const savedSettings=async()=>{await savedHome();await savedPage.locator('.native-home-header [data-go="settings"]').click();};
 const chooser=async()=>{await savedSettings();await savedPage.locator('#switch-saved-login').click();await savedPage.locator('#saved-login-slots').waitFor()};
 await savedPage.goto(origin);
 await savedPage.waitForFunction(()=>!document.getElementById('login-mode-xtream')?.disabled);
 await savedPage.locator('#activation-code').fill('12345678');
 await savedPage.locator('#redeem').click();await savedHome();
 await savedSettings();await savedPage.locator('#picture-fit').click();
 assert.equal(await savedPage.locator('#picture-fit-label').textContent(),'تكبير');
 await savedPage.locator('#switch-saved-login').click();
 await savedPage.locator('[data-saved-mode="code"]').waitFor();
 await savedPage.locator('#login-mode-xtream').click();
 await savedPage.locator('#provider-username').fill('fixture-user');
 await savedPage.locator('#provider-password').fill('fixture-secret');
 await savedPage.locator('#redeem').click();await savedHome();
 await savedSettings();
 assert.equal(await savedPage.locator('#picture-fit-label').textContent(),'ملاءمة');
 await savedPage.locator('#switch-saved-login').click();
 await savedPage.locator('[data-saved-mode="code"]').waitFor();
 failSwitch=true;await savedPage.locator('[data-saved-mode="code"]').click();
 await savedPage.waitForFunction(()=>document.getElementById('login-status')?.textContent.includes('تعذر التبديل'));
 assert.equal(activeMode,'xtream');failSwitch=false;
 await savedPage.locator('[data-saved-mode="code"]').click();await savedHome();
 await savedPage.reload();await savedSettings();
 assert.equal(await savedPage.locator('#picture-fit-label').textContent(),'تكبير');
 await savedPage.locator('#switch-saved-login').click();
 await savedPage.locator('[data-saved-mode="xtream"]').waitFor();
 await savedPage.locator('#login-mode-m3u').click();
 await savedPage.locator('#provider-url').fill('https://x.blofyplayer.com/get.php?username=fixture-user&password=fixture-secret');
 await savedPage.locator('#redeem').click();await savedHome();
 await chooser();await savedPage.locator('[data-saved-mode="xtream"]').click();await savedHome();
 assert.deepEqual(loginCalls,['code','xtream','m3u']);
 assert.equal(activeMode,'xtream');
 const storage=await savedPage.evaluate(()=>JSON.stringify(localStorage));
 assert.ok(!storage.includes('fixture-secret')&&!storage.includes('fixture-user')&&!storage.includes('12345678'));
 await savedSettings();await savedPage.locator('#logout').click();
 await savedPage.locator('#activation-code').waitFor();
 await savedPage.reload();await savedPage.locator('#activation-code').waitFor();
 assert.equal(savedModes.size,0);assert.equal(activeMode,null);
 assert.deepEqual(savedErrors,[]);
 console.log('BLOFY_SAVED_LOGIN_SYNTHETIC_PASS three independent modes, reload, settings isolation, failed switch and explicit logout');
 await accounts.close();await browser.close();browser=null;
 // Chrome is installed in browser QA and supports native H.264/AAC MP4 decoding.
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const offline=await browser.newContext({serviceWorkers:'allow'});
 const offPage=await offline.newPage(),profile='c'.repeat(24),expiresAt=Date.now()+3600000;
 let activated=false,mediaCalls=0,translationCalls=0;
 await offline.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin)return route.abort();
  const p=u.pathname;
  if(p==='/api/download/movie/123.mp4'){
   mediaCalls++;const bytes=readFileSync('qa-fixtures/offline.mp4');
   return route.fulfill({status:200,body:bytes,headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="fixture.mp4"','content-length':String(bytes.length)}});
  }
  if(!p.startsWith('/api/'))return route.continue();
  const respond=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(p==='/api/session')return respond(activated?200:401,activated?{ok:true,active:true,profileKey:profile,expiresAt}:{active:false});
  if(p==='/api/redeem'){activated=true;return respond(200,{ok:true,profileKey:profile,expiresAt})}
  if(p==='/api/login-modes')return respond(200,{direct:false});
  if(p==='/api/page')return respond(200,{items:u.searchParams.get('kind')==='movie'?[{stream_id:123,name:'Offline fixture',container_extension:'mp4'}]:[],total:1,hasMore:false,nextOffset:null});
  if(p==='/api/catalog'&&u.searchParams.get('action')==='get_vod_info')return respond(200,{info:{plot:'A synthetic film description.'}});
  if(p==='/api/ai/translate'){translationCalls++;assert.equal(route.request().postDataJSON().overview,'A synthetic film description.');return respond(200,{ok:true,translatedOverview:'وصف تجريبي للفيلم'});}
  return respond(200,[]);
 });
 await offPage.goto(origin);
 await offPage.locator('#activation-code').fill('12345678');
 await offPage.locator('#redeem').click();
 await offPage.locator('.rail-link[data-go="downloads"]').waitFor();
 await offPage.locator('[data-details="movie:123"]').first().click();
 await offPage.locator('[data-download="movie:123"]').waitFor();
 await offPage.waitForFunction(()=>document.getElementById('detail-plot-text')?.textContent==='وصف تجريبي للفيلم');
 await offPage.locator('#detail-translate').click();
 assert.equal(await offPage.locator('#detail-plot-text').textContent(),'A synthetic film description.');
 await offPage.locator('#detail-translate').click();
 assert.equal(await offPage.locator('#detail-plot-text').textContent(),'وصف تجريبي للفيلم');
 assert.equal(translationCalls,1);
 await offPage.evaluate(async()=>{await navigator.serviceWorker.ready});
 await offPage.locator('[data-download="movie:123"]').click();
 await offPage.getByText('اكتمل التنزيل. افتح التنزيلات للمشاهدة دون إنترنت.',{exact:true}).waitFor();
 await offPage.locator('.rail-link[data-go="downloads"]').click();
 await offPage.getByText('Offline fixture',{exact:true}).waitFor();
 assert.equal(mediaCalls,1);
 await offPage.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await offline.setOffline(true);
 await offPage.reload({waitUntil:'domcontentloaded'});
 await offPage.locator('#offline-reconnect').waitFor();
 await offPage.locator('[data-offline-play="0"]').click();
 await offPage.locator('#offline-video').waitFor();
 try{await offPage.waitForFunction(()=>{const v=document.getElementById('offline-video');return v&&v.readyState>=2&&v.videoWidth>0},null,{timeout:12000})}catch(e){
  console.log('BLOFY_OFFLINE_VIDEO_DIAGNOSTIC',await offPage.evaluate(()=>{const v=document.getElementById('offline-video');return {ready:v?.readyState,network:v?.networkState,error:v?.error?.code,message:v?.error?.message,src:v?.src?.startsWith('blob:'),codec:v?.canPlayType('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),status:document.getElementById('offline-status')?.textContent}}));throw e
 }
 await offPage.locator('#offline-video').evaluate(v=>{v.muted=true;return v.play()});
 await offPage.waitForFunction(()=>document.getElementById('offline-video').currentTime>0.25);
 assert.equal(mediaCalls,1);
 await offPage.locator('[data-offline-delete="0"]').click();
 await offPage.waitForFunction(()=>!document.querySelector('[data-offline-play]'));
 console.log('BLOFY_OFFLINE_MP4_BROWSER_PASS complete file on disk, offline reload, decoded video, deletion');
 await offline.close();
}finally{await browser?.close();await new Promise(r=>server.close(r))}

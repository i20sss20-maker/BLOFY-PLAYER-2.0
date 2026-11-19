// Real Chromium render audit under Android-sized touch/browser emulation.
// Static fixture serves the actual built HTML/CSS/JS from this repository.
// Checkout is deliberately DISABLED; no Geidea sessions or codes are created.
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

const root=new URL('../web/',import.meta.url);
const output=new URL('../artifacts/mobile-browser/',import.meta.url);
const html={
 '/':'store.html',
 '/products/stream':'store.html',
 '/store/cart':'store-cart.html',
 '/store/assistant':'store-assistant.html',
 '/distributor':'store-reseller.html'
};
const assets={
 '/blofy-logo.png':'blofy-logo.png',
 '/store/design.css':'store-premium.css',
 '/store/market.css':'store-market.css',
 '/store/visual.css':'store-visual.css',
 '/store/offers.js':'store-offers.js',
 '/store/showcase.js':'store-showcase.js',
 '/store/market.js':'store-market.js',
 '/store/cart.css':'store-cart.css',
 '/store/checkout-theme.css':'store-checkout-theme.css',
 '/store/cart.js':'store-cart.js',
 '/store/assistant.css':'store-assistant.css',
 '/store/assistant.js':'store-assistant.js',
 '/distributor/style.css':'store-reseller.css',
 '/distributor/app.js':'store-reseller.js',
 '/store/media/strong8k.jpg':'banner-strong8k-ai.jpg',
 '/store/media/player.jpg':'banner-player-ai.jpg',
 '/store/media/bundle.svg':'store-bundle-banner.svg',
 '/store/media/stream.svg':'store-stream.svg',
 '/store/media/xtream.svg':'store-xtream.svg',
 '/store/media/strong8k.svg':'store-strong8k-banner.svg',
 '/store/media/player.svg':'store-player-banner.svg'
};
const contentType=file=>file.endsWith('.html')?'text/html; charset=utf-8':
 file.endsWith('.css')?'text/css; charset=utf-8':
 file.endsWith('.js')?'application/javascript; charset=utf-8':
 file.endsWith('.svg')?'image/svg+xml':
 file.endsWith('.jpg')?'image/jpeg':
 file.endsWith('.png')?'image/png':'application/octet-stream';
const server=http.createServer(async(req,res)=>{
 const path=new URL(req.url||'/', 'http://127.0.0.1').pathname;
 if(path.startsWith('/api/')){
  // Never simulate a paid order in a storefront performance audit.
  const payload=JSON.stringify({
   ok:true,provider:'geidea',checkoutAvailable:false,
   products:[],offers:[],items:[],config:{},
   campaigns:[], branding:{}
  });
  res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(payload),
   'cache-control':'no-store'});return res.end(payload);
 }
 const filename=html[path]||assets[path];
 if(!filename){
  res.writeHead(404,{'content-type':'text/plain'});return res.end('not found');
 }
 try{
  const bytes=await readFile(new URL(filename,root));
  res.writeHead(200,{
   'content-type':contentType(filename),'content-length':bytes.length,
   'cache-control':'public,max-age=900','x-content-type-options':'nosniff'
  });res.end(bytes);
 }catch{
  res.writeHead(404,{'content-type':'text/plain'});res.end('missing fixture');
 }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
const base='http://127.0.0.1:'+address.port;
const report=[];
let browser;
try{
 await mkdir(output,{recursive:true});
 browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--no-sandbox']});
 const scenarios=[
  {name:'store-360',path:'/',width:360,height:780},
  {name:'store-390',path:'/',width:390,height:844},
  {name:'store-tablet-768',path:'/',width:768,height:900},
  {name:'cart-390',path:'/store/cart',width:390,height:844},
  {name:'assistant-390',path:'/store/assistant',width:390,height:844},
  {name:'reseller-390',path:'/distributor',width:390,height:844}
 ];
 for(const scenario of scenarios){
  const context=await browser.newContext({
   viewport:{width:scenario.width,height:scenario.height},
   deviceScaleFactor:2,isMobile:true,hasTouch:true,
   locale:'ar-SA',timezoneId:'Asia/Riyadh',reducedMotion:'reduce',
   serviceWorkers:'block'
  });
  const page=await context.newPage();
  const badExternal=[],pageErrors=[];
  let resourcesBytes=0,firstPartyRequests=0,checkoutPost=0;
  await page.route('**/*',async route=>{
   const request=route.request();
   if(!request.url().startsWith(base)){
    if(/^https?:/.test(request.url()))badExternal.push(request.url());
    return route.abort('blockedbyclient');
   }
   if(request.method()==='POST'&&/\/api\/v1\/store\/checkout/.test(request.url())){
    checkoutPost++;return route.abort('blockedbyclient');
   }
   return route.continue();
  });
  page.on('pageerror',e=>pageErrors.push(String(e).slice(0,250)));
  page.on('response',async response=>{
   if(!response.url().startsWith(base))return;
   firstPartyRequests++;
   const n=Number(response.headers()['content-length']||0);
   if(Number.isFinite(n)&&n>0)resourcesBytes+=n;
  });
  await page.addInitScript(()=>{
   window.__audit={cls:0,lcp:0};
   new PerformanceObserver(list=>{
    for(const entry of list.getEntries()){
     if(!entry.hadRecentInput)window.__audit.cls+=entry.value;
    }
   }).observe({type:'layout-shift',buffered:true});
   new PerformanceObserver(list=>{
    for(const entry of list.getEntries())window.__audit.lcp=entry.startTime;
   }).observe({type:'largest-contentful-paint',buffered:true});
  });
  const response=await page.goto(base+scenario.path,{waitUntil:'load',timeout:30000});
  await page.waitForTimeout(700);
  const metrics=await page.evaluate(()=>{
   const nav=performance.getEntriesByType('navigation')[0];
   const fcp=performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null;
   return {
    viewport:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
    bodyWidth:document.body.scrollWidth,
    fcp:Math.round(fcp??0),lcp:Math.round(window.__audit?.lcp??0),
    cls:Math.round((window.__audit?.cls??0)*1000)/1000,
    readyState:document.readyState,domLoaded:Math.round(nav?.domContentLoadedEventEnd??0),
    scriptCount:document.scripts.length,
    geideaSdkLoaded:typeof window.GeideaCheckout==='function',
    sdkTagPresent:!!document.querySelector('script[src*="geideaCheckout.min.js"]')
   };
  });
  await page.screenshot({path:fileURLToPath(new URL(scenario.name+'.png',output)),
   fullPage:false,animations:'disabled'});
  const item={...scenario,httpStatus:response?.status()??0,...metrics,
   firstPartyRequests,resourcesBytes,externalBlocked:badExternal.length,
   checkoutPost,pageErrors};
  report.push(item);
  console.log(JSON.stringify(item));
  if(response?.status()!==200)throw Error(scenario.name+': root HTTP status failed');
  if(metrics.scrollWidth>scenario.width+2||metrics.bodyWidth>scenario.width+2)
   throw Error(scenario.name+': horizontal overflow '+metrics.scrollWidth+'px');
  if(!metrics.fcp||metrics.fcp>6000)
   throw Error(scenario.name+': first contentful paint budget exceeded');
  if(metrics.cls>0.25)throw Error(scenario.name+': layout shift budget exceeded');
  if(resourcesBytes>1_100_000)
   throw Error(scenario.name+': first-party transferred bytes budget exceeded');
  if(checkoutPost)throw Error('performance tests must never initiate checkout');
  if(scenario.path==='/'&&metrics.sdkTagPresent)
   throw Error('Geidea SDK was loaded before a purchase action');
  if(scenario.path==='/distributor'){
   const visible=await page.locator('#login-panel').isVisible();
   if(!visible)throw Error('mobile reseller login inaccessible');
  }
  await context.close();
 }
 await writeFile(new URL('results.json',output),
  JSON.stringify({generatedAt:new Date().toISOString(),environment:'Chromium mobile emulation, no real network or payment',
   scenarios:report},null,2));
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}

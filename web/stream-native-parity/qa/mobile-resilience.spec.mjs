import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test.use({channel:'chrome'});
const movie={stream_id:11,name:'فيلم اختبار اللمس',category_id:'1',container_extension:'mp4'};
const catalogs={movie:[movie],live:[],series:[]};
test.beforeEach(async({page})=>{
 await page.route('**/api/session',r=>r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,active:true,profileKey:'0123456789abcdef01234567'})}));
 await page.route('**/api/page?*',route=>{
  const u=new URL(route.request().url()),kind=u.searchParams.get('kind'),items=catalogs[kind]||[];
  return route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({items,hasMore:false,nextOffset:items.length,kind})})
 });
 await page.route('**/api/catalog?*',route=>{
  const action=new URL(route.request().url()).searchParams.get('action');
  let data=[];
  if(action==='get_vod_categories')data=[{category_id:'1',category_name:'الاختبار'}];
  if(action==='get_vod_info')data={info:{duration_secs:4,plot:'اختبار واجهة اللمس'},movie_data:movie};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
 });
 await page.route('https://example.com/**',route=>route.fulfill({status:404,body:''}));
});

test('offline and restored notices are advisory, no playback or reload side effects',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // history.replaceState may emit framenavigated without loading a new document.
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.home-hero')).toBeVisible();
 await page.evaluate(()=>{window.__blofyNetworkProbe='same-document'})
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
 await expect(page.locator('#blofy-connectivity-notice')).toContainText('غير متصل');
 await expect(page.locator('#blofy-connectivity-notice')).toHaveAttribute('data-connection','offline');
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('#blofy-connectivity-notice')).toContainText('حسب المتصفح');
 await expect(page.locator('#blofy-connectivity-notice')).toHaveAttribute('data-connection','restored');
 expect(await page.evaluate(()=>window.__blofyNetworkProbe)).toBe('same-document');
 expect(errors).toEqual([]);
});

test('touch-mode real MP4 has one VOD double-tap seek and visible feedback',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const mp4=readFileSync('/tmp/blofy-qa-test.mp4');
 await page.route('**/api/media/movie/11.mp4',async route=>{
  const range=route.request().headers()['range'];let first=0,last=mp4.length-1,status=200;
  if(range){
   const m=range.match(/bytes=(\d+)-(\d*)/);
   if(m){first=Number(m[1]);last=m[2]?Math.min(Number(m[2]),last):last;status=206}
  }
  const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes',
   'Content-Length':String(last-first+1)};
  if(status===206)headers['Content-Range']='bytes '+first+'-'+last+'/'+mp4.length;
  await route.fulfill({status,headers,body:mp4.subarray(first,last+1)})
 });
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
 await page.locator('[data-go="movie"]').first().click();
 await page.locator('[data-details="movie:11"]').click();
 await page.locator('[data-watch="movie:11"]').first().click();
 await expect(page.locator('#player-root')).toBeVisible();
 await page.evaluate(()=>{
  document.documentElement.setAttribute('data-blofy-device','touch');
  document.documentElement.setAttribute('data-blofy-input','touch');
 });
 await expect(page.locator('#mobile-player-actions')).toBeVisible();
 await expect.poll(()=>page.locator('#player-media').evaluate(v=>v.readyState),
  {timeout:12000}).toBeGreaterThan(1);
 await expect.poll(()=>page.locator('#player-media').evaluate(v=>v.paused),
  {timeout:12000}).toBe(false);
 await page.locator('#player-media').evaluate(v=>{
  const r=v.getBoundingClientRect(),x=r.left+r.width*0.85,y=r.top+r.height*0.52;
  v.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',clientX:x,clientY:y}));
 });
 await page.waitForTimeout(135);
 await page.locator('#player-media').evaluate(v=>{
  const r=v.getBoundingClientRect(),x=r.left+r.width*0.85,y=r.top+r.height*0.52;
  v.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',clientX:x,clientY:y}));
 });
 await expect(page.locator('#mobile-seek-feedback')).toBeVisible();
 await expect(page.locator('#mobile-seek-feedback')).toContainText('+10 ثوانٍ');
 await expect(page.locator('#player-root')).not.toHaveClass(/controls-hidden/);
 expect(errors).toEqual([]);
});

import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const movie={stream_id:11,name:'فيلم تجريبي',category_id:'1',container_extension:'mp4',stream_icon:'https://example.com/movie.jpg'};
const series={series_id:21,name:'مسلسل تجريبي',category_id:'3',cover:'https://example.com/show.jpg'};
const channel={stream_id:31,name:'قناة اختبار',category_id:'4',stream_icon:'https://example.com/channel.jpg'};
const episode={id:55,title:'الحلقة التجريبية',episode_num:1,container_extension:'mp4',info:{duration_secs:60}};
const kinds={movie:[movie],series:[series],live:[channel]};
test.beforeEach(async({page})=>{
 await page.route('**/api/session',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,active:true})}));
 await page.route('**/api/page?*',async route=>{
  const u=new URL(route.request().url()),kind=u.searchParams.get('kind'),items=kinds[kind]||[];
  const q=u.searchParams.get('query');const rows=q?items.filter(x=>x.name.includes(q)):items;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:rows,hasMore:false,nextOffset:rows.length,kind})});
 });
 await page.route('**/api/catalog?*',async route=>{
  const u=new URL(route.request().url()),action=u.searchParams.get('action');let out={};
  if(action==='get_vod_categories')out=[{category_id:'1',category_name:'أفلام متنوعة'}];
  if(action==='get_series_categories')out=[{category_id:'3',category_name:'مسلسلات عربية'}];
  if(action==='get_live_categories')out=[{category_id:'4',category_name:'قنوات عامة'}];
  if(action==='get_vod_info')out={info:{movie_image:'https://example.com/movie.jpg',duration_secs:4,plot:'فيلم اختبار'},movie_data:movie};
  if(action==='get_series_info')out={info:{cover:'https://example.com/show.jpg',plot:'قصة اختبار'},episodes:{'1':[episode]}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
 });
 await page.route('https://example.com/**',async r=>r.fulfill({status:404,body:''}));
 await page.route('**/api/player-diagnostic',async r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
 await page.route('**/api/hls/**',async r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"qa_fake_stream"}'}));
});
test('home matches STREAM palette and navigation is clickable',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.home-hero')).toBeVisible();
 await expect(page.locator('.rail')).toHaveCSS('width','150px');
 await expect(page.locator('.poster')).toHaveCount(2);
 await page.locator('[data-go="movie"]').first().click();
 await expect(page.locator('.poster-grid .poster')).toHaveCount(1);
 await page.locator('[data-details="movie:11"]').click();
 await expect(page.locator('.detail-title')).toHaveText('فيلم تجريبي');
 await page.locator('[data-favorite="movie:11"]').click();
 await expect(page.locator('[data-favorite="movie:11"]')).toContainText('إزالة');
 await page.locator('[data-go="favorites"]').click();
 await expect(page.locator('.poster-grid .poster')).toHaveCount(1);
 expect(errors).toEqual([]);
});
test('series details opens the season and episode list',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="series"]').first().click();
 await page.locator('[data-details="series:21"]').click();
 await expect(page.locator('.detail-title')).toContainText('مسلسل تجريبي');
 await page.locator('[data-episodes="21"]').first().click();
 await expect(page.locator('.episode-row')).toHaveCount(1);
 await expect(page.locator('.episode-name')).toContainText('الحلقة');
 expect(errors).toEqual([]);
});
test('live screen has three panes and channel click selects video without page crash',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="live"]').first().click();
 await expect(page.locator('.cat-rail')).toBeVisible();
 await expect(page.locator('.channels')).toBeVisible();
 await expect(page.locator('.preview')).toBeVisible();
 await page.locator('[data-channel="31"]').click();
 await expect(page.locator('#live-title')).toHaveText('قناة اختبار');
 expect(errors).toEqual([]);
});
test('VOD MP4 can open real HTML5 media; restart-from-zero overrides stored position',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const mp4=readFileSync('/tmp/blofy-qa-test.mp4');
 const network=[];page.on('response',r=>{if(/api\/(?:vod|media)/.test(r.url()))network.push({url:r.url().split('?')[0],status:r.status()})});page.on('requestfailed',r=>{if(/api\/(?:vod|media)/.test(r.url()))network.push({url:r.url().split('?')[0],failed:r.failure()})});
 await page.route('**/api/media/movie/11.mp4',async route=>{
  const range=route.request().headers()['range'];let start=0,end=mp4.length-1,status=200;
  if(range){const m=range.match(/bytes=(\d+)-(\d*)/);if(m){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;status=206}}
  const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1)};if(status===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+mp4.length;
  await route.fulfill({status,headers,body:mp4.subarray(start,end+1)});
 });
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="movie"]').first().click();
 await page.locator('[data-details="movie:11"]').click();
 await page.locator('[data-watch="movie:11"]').first().click();
 await expect(page.locator('#player-root')).toBeVisible();
 await page.waitForTimeout(1100);
 console.log('BLOFY QA VIDEO STATE',JSON.stringify(await page.locator('#player-media').evaluate(v=>({src:v.currentSrc,ready:v.readyState,network:v.networkState,error:v.error&&{code:v.error.code,message:v.error.message},duration:v.duration,paused:v.paused,seekable:v.seekable.length}))));
 console.log('BLOFY QA MEDIA REQUESTS',JSON.stringify(network));
 await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState),{timeout:5000}).toBeGreaterThan(0);
 await page.locator('#player-restart').click();
 await expect(page.locator('#player-root')).toBeVisible();
 await page.locator('#player-back').click();
 await expect(page.locator('.detail-title')).toHaveText('فيلم تجريبي');
 expect(errors).toEqual([]);
});

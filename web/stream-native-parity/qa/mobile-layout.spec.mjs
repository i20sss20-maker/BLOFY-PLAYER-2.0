import {test,expect} from '@playwright/test';
test.use({channel:'chrome'});
const movie={stream_id:11,name:'فيلم تجريبي',category_id:'1',container_extension:'mp4'};
const series={series_id:21,name:'مسلسل تجريبي',category_id:'3'};
const channels=[
 {stream_id:31,name:'القناة الأولى',category_id:'4'},
 {stream_id:32,name:'القناة الثانية',category_id:'4'}
];
const items={movie:[movie],series:[series],live:channels};
test.beforeEach(async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/session',r=>r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,active:true,profileKey:'0123456789abcdef01234567'})}));
 await page.route('**/api/page?*',r=>{
  const u=new URL(r.request().url()),kind=u.searchParams.get('kind'),list=items[kind]||[];
  return r.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({items:list,hasMore:false,nextOffset:list.length,kind})})
 });
 await page.route('**/api/catalog?*',r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  let result=[];
  if(action==='get_vod_categories')result=[{category_id:'1',category_name:'أفلام'}];
  if(action==='get_series_categories')result=[{category_id:'3',category_name:'مسلسلات'}];
  if(action==='get_live_categories')result=[{category_id:'4',category_name:'القنوات'}];
  if(action==='get_vod_info')result={info:{plot:'فيلم اختبار'},movie_data:movie};
  if(action==='get_series_info')result={info:{plot:'مسلسل اختبار'},episodes:{}};
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)})
 });
 await page.route('https://example.com/**',r=>r.fulfill({status:404,body:''}));
});
async function touch(page){
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.home-hero')).toBeVisible();
 await page.evaluate(()=>{
  document.documentElement.setAttribute('data-blofy-device','touch');
  document.documentElement.setAttribute('data-blofy-input','touch');
 })
}
async function noHorizontalOverflow(page){
 return page.evaluate(()=>{
  const doc=document.documentElement;
  return {scrollWidth:doc.scrollWidth,clientWidth:doc.clientWidth}
 })
}
test('iPhone-sized home has five accessible main tabs, hero and two-column tiles',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await touch(page);
 const rail=page.locator('.app > .rail');
 await expect(rail).toBeVisible();
 await expect(page.locator('.home-hero')).toBeVisible();
 const sizes=await page.evaluate(()=>{
  const nav=document.querySelector('.app>.rail');
  const navBox=nav.getBoundingClientRect();
  const hero=document.querySelector('.home-hero').getBoundingClientRect();
  return {navHeight:navBox.height,navBottom:navBox.bottom,
   tabs:nav.querySelectorAll('.rail-link').length,heroWidth:hero.width,
   grid:getComputedStyle(document.querySelector('.story-row')).gridTemplateColumns}
 });
 expect(sizes.navHeight).toBeGreaterThan(65);
 expect(sizes.navBottom).toBeLessThanOrEqual(846);
 expect(sizes.tabs).toBeGreaterThanOrEqual(5);
 expect(sizes.heroWidth).toBeGreaterThan(315);
 expect(sizes.grid.split(' ').length).toBe(2);
 const overflow=await noHorizontalOverflow(page);
 expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth+1);
 expect(errors).toEqual([]);
});

test('live catalog on a touch phone prioritizes channels and keeps optional preview below',async({page})=>{
 await touch(page);
 await page.locator('[data-go="live"]').first().click();
 await expect(page.locator('.catalog-app .mobile-catalog-nav .rail')).toBeVisible();
 await expect(page.locator('#live-video')).toBeAttached();
 const layout=await page.evaluate(()=>{
  const rail=document.querySelector('.mobile-catalog-nav .rail');
  const list=document.querySelector('.catalog .channels');
  const video=document.querySelector('.catalog .preview');
  const category=document.querySelector('.catalog .cat-rail');
  const player=document.querySelector('.preview-video-wrap');
  return {nav:getComputedStyle(rail).display,previewOrder:getComputedStyle(video).order,
   channelOrder:getComputedStyle(list).order,categoryOrder:getComputedStyle(category).order,
   videoRatio:player.getBoundingClientRect().width/player.getBoundingClientRect().height}
 });
 expect(layout.nav).toBe('flex');
 expect(Number(layout.categoryOrder)).toBeLessThan(Number(layout.channelOrder));
 expect(Number(layout.channelOrder)).toBeLessThan(Number(layout.previewOrder));
 expect(layout.videoRatio).toBeGreaterThan(1.5);
 expect(layout.videoRatio).toBeLessThan(1.95);
 await page.locator('[data-channel="32"]').click();
 await expect(page.locator('#live-title')).toContainText('القناة الثانية');
 // Selecting a channel should reveal the original video element, not replace it.
 await expect(page.locator('#live-video')).toHaveCount(1);
 await expect(page.locator('.mobile-catalog-nav .rail-link[aria-current="page"]')).toHaveAttribute('data-go','live');
 const overflow=await noHorizontalOverflow(page);
 expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth+1)
});

test('phone catalog tabs navigate to movies and series without losing the mobile rail',async({page})=>{
 await touch(page);
 await page.locator('[data-go="movie"]').first().click();
 await expect(page.locator('.catalog-app .mobile-catalog-nav .rail')).toBeVisible();
 await expect(page.locator('.catalog .poster-grid .poster')).toHaveCount(1);
 await expect(page.locator('.catalog .poster-grid')).toHaveCSS('grid-template-columns',/\d/);
 await page.locator('.mobile-catalog-nav [data-go="series"]').click();
 await expect(page.locator('.catalog .poster-grid .poster')).toHaveCount(1);
 await expect(page.locator('.mobile-catalog-nav [aria-current="page"]')).toHaveAttribute('data-go','series');
});

test('320px phone preserves narrow toolbar, bottom controls and avoids document x-scroll',async({page})=>{
 await page.setViewportSize({width:320,height:700});
 await touch(page);
 await expect(page.locator('.app > .rail')).toBeVisible();
 let overflow=await noHorizontalOverflow(page);
 expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth+1);
 await page.locator('[data-go="live"]').first().click();
 await expect(page.locator('.catalog-app .mobile-catalog-nav .rail')).toBeVisible();
 const buttons=await page.locator('.catalog-app .toolbar .btn:visible').evaluateAll(els=>
  els.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
 expect(buttons.length).toBeGreaterThanOrEqual(2);
 expect(buttons.every(x=>x.width>0&&x.height>=42)).toBe(true);
 overflow=await noHorizontalOverflow(page);
 expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth+1);
});

test('desktop and VIDAA-style view does not expose duplicate catalog bottom nav',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await page.goto('http://127.0.0.1:3000/');
 await expect(page.locator('.home-hero')).toBeVisible();
 await page.locator('[data-go="live"]').first().click();
 await expect(page.locator('.catalog-app .mobile-catalog-nav')).toBeHidden();
 await expect(page.locator('.catalog-app .catalog .cat-rail')).toBeVisible();
});


test('compact iPhone preview reveals only after explicit preview tap without media element rebuild',async({page})=>{
 await touch(page);
 await page.locator('[data-go="live"]').first().click();
 await expect(page.locator('.catalog .preview')).toBeVisible();
 await page.evaluate(()=>{
  document.documentElement.setAttribute('data-blofy-ios','true');
  document.querySelector('.preview').classList.add('preview-idle')
 });
 await expect(page.locator('.preview-video-wrap')).toBeHidden();
 await expect(page.locator('[data-preview-play]')).toBeVisible();
 await page.locator('[data-preview-play]').click();
 await expect(page.locator('.preview')).not.toHaveClass(/preview-idle/);
 await expect(page.locator('.preview-video-wrap')).toBeVisible();
 await expect(page.locator('#live-video')).toHaveCount(1);
});

test('vector bottom navigation remains operable without clipping, and active tab stays visible',async({page})=>{
 await touch(page);
 await expect(page.locator('.rail-link .nav-svg')).toHaveCount(11);
 await expect(page.locator('.rail-link[data-go="downloads"]')).toHaveCount(1);
 await expect(page.locator('.rail-link[data-go="commentators"]')).toHaveCount(1);
 await page.locator('[data-go="settings"]').first().click();
 await expect(page.locator('.rail-link[data-go="settings"]')).toHaveAttribute('aria-current','page');
 const state=await page.evaluate(()=>{
  const nav=document.querySelector('.rail'),active=nav.querySelector('[aria-current="page"]');
  const r=nav.getBoundingClientRect(),a=active.getBoundingClientRect();
  return {visible:a.left>=r.left-1&&a.right<=r.right+1,
   hit:a.width>=44&&a.height>=44,
   overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}
 });
 expect(state.visible).toBe(true);
 expect(state.hit).toBe(true);
 expect(state.overflow).toBeLessThanOrEqual(1)
});


test('actual browser loads native Arabic font and brand assets from app origin with no external CDN',async({page,request})=>{
 await touch(page);
 const fonts=await page.evaluate(async()=>{
  await document.fonts.load('400 18px "BLOFY Plex Arabic"','الصفحة الرئيسية');
  await document.fonts.load('700 18px "BLOFY Plex Arabic"','البث المباشر');
  await document.fonts.ready;
  return {
   regular:document.fonts.check('400 18px "BLOFY Plex Arabic"','العربية'),
   bold:document.fonts.check('700 18px "BLOFY Plex Arabic"','العربية'),
   family:getComputedStyle(document.body).fontFamily,
   brand:getComputedStyle(document.querySelector('.app .brand'),'::before').backgroundImage
  }
 });
 expect(fonts.regular).toBe(true);
 expect(fonts.bold).toBe(true);
 expect(fonts.family).toContain('BLOFY Plex Arabic');
 expect(fonts.brand).toContain('stream-icon.svg');
 for(const asset of [
  ['fonts/IBMPlexSansArabic-Regular.ttf','font/ttf'],
  ['fonts/IBMPlexSansArabic-SemiBold.ttf','font/ttf'],
  ['apple-touch-icon.png','image/png'],
  ['icon-192.png','image/png'],
  ['icon-512.png','image/png'],
  ['stream-icon.svg','image/svg+xml']
 ]){
  const response=await request.get('http://127.0.0.1:3000/'+asset[0]);
  expect(response.status(),asset[0]).toBe(200);
  expect(response.headers()['content-type'],asset[0]).toContain(asset[1])
 }
});

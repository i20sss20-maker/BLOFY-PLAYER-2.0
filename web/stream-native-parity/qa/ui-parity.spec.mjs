import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test.use({channel:'chrome'});
const movie={stream_id:11,name:'فيلم تجريبي',category_id:'1',container_extension:'mp4',stream_icon:'https://example.com/movie.jpg'};
const series={series_id:21,name:'مسلسل تجريبي',category_id:'3',cover:'https://example.com/show.jpg'};
const channel={stream_id:31,name:'قناة اختبار',category_id:'4',stream_icon:'https://example.com/channel.jpg'};
const episode={id:55,title:'الحلقة التجريبية',episode_num:1,container_extension:'mp4',info:{duration_secs:60}};
const channel2={stream_id:32,name:'قناة ثانية',category_id:'4',stream_icon:'https://example.com/channel2.jpg'};
const kinds={movie:[movie],series:[series],live:[channel,channel2]};
test.beforeEach(async({page})=>{
 await page.route('**/api/session',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,active:true,profileKey:'0123456789abcdef01234567'})}));
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
test('switching channels and leaving live releases the old media worker session',async({page})=>{
 const stops=[];page.on('request',req=>{if(req.method()==='POST'&&req.url().includes('/api/hls/live/')&&req.url().endsWith('/stop'))stops.push(req.url())});
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="live"]').first().click();
 await page.locator('[data-channel="31"]').click();
 await page.locator('[data-channel="32"]').click();
 await expect.poll(()=>stops.length).toBeGreaterThanOrEqual(1);
 await page.locator('[data-go="movie"]').first().click();
 await expect.poll(()=>stops.length).toBeGreaterThanOrEqual(2);
});
test('Chrome uses local Hls.js and decodes H.264/AAC HLS instead of native unsupported source',async({page})=>{
 const manifest=readFileSync('/tmp/blofy-qa-hls/index.m3u8','utf8');
 const segments={};
 for(const name of [...new Set(manifest.match(/seg-[0-9]{6}[.]ts/g)||[])])segments[name]=readFileSync('/tmp/blofy-qa-hls/'+name);
 const requested=[],responses=[],errors=[];
 page.on('request',r=>{if(r.url().includes('/vendor/hls.min.js'))requested.push(r.url())});
 page.on('response',r=>{if(r.url().includes('/vendor/hls')||r.url().includes('/api/hls/'))responses.push({url:r.url().split('/').slice(-2).join('/'),status:r.status()})});
 page.on('pageerror',e=>errors.push('page:'+e.message));
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push('console:'+m.text().slice(0,250))});
 await page.route('**/api/hls/live/31/ts/0/**',async route=>{
  const name=route.request().url().split('/').pop().split('?')[0];
  if(name==='index.m3u8')return route.fulfill({status:200,contentType:'application/vnd.apple.mpegurl',body:manifest});
  if(segments[name])return route.fulfill({status:200,contentType:'video/mp2t',body:segments[name]});
  return route.fulfill({status:404,body:'not_found'});
 });
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="live"]').first().click();
 await page.locator('[data-channel="31"]').click();
 await expect.poll(()=>requested.length,{timeout:10000}).toBeGreaterThan(0);
 await page.waitForTimeout(4000);
 console.log('BLOFY HLS DIAGNOSTICS',JSON.stringify({
  responses,errors,
  player:await page.locator('#live-video').evaluate(v=>({ready:v.readyState,error:v.error&&{code:v.error.code,message:v.error.message},currentSrc:v.currentSrc,muted:v.muted,paused:v.paused,network:v.networkState,canMse:!!window.MediaSource,hasHls:!!window.Hls,hlsSupported:!!(window.Hls&&window.Hls.isSupported()),currentTime:v.currentTime})),
  status:await page.locator('#live-status').textContent()
 }));
 await expect.poll(()=>page.locator('#live-video').evaluate(v=>v.readyState),{timeout:14000}).toBeGreaterThan(1);
 const state=await page.locator('#live-video').evaluate(v=>({ready:v.readyState,error:v.error&&v.error.code,paused:v.paused}));
 expect(state.error).toBeFalsy();
 await page.locator('[data-preview-full]').click();
 await expect(page.locator('#player-root')).toBeVisible();
 await expect.poll(()=>page.locator('#player-media').evaluate(v=>v.readyState),{timeout:14000}).toBeGreaterThan(1);
 await expect(page.locator('#player-status')).toBeHidden({timeout:10000});
 await expect(page.locator('#player-toggle')).toBeVisible();
});
test('unknown-duration MKV VOD fallback decodes a temporary HLS playlist',async({page})=>{
 movie.container_extension='mkv';delete movie.duration_secs;
 const text=readFileSync('/tmp/blofy-qa-hls/index.m3u8','utf8');
 const names=[...new Set(text.match(/seg-[0-9]{6}[.]ts/g)||[])];
 expect(names.length).toBeGreaterThanOrEqual(2);
 const segments={};for(const name of names)segments[name]=readFileSync('/tmp/blofy-qa-hls/'+name);
 let first=0;const errors=[];const requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/vod/'))requests.push({path:r.url().split('/').slice(-1)[0],status:r.status()})});
 await page.route('**/api/vod/movie/11/mkv/0/0/**',async route=>{
  const name=route.request().url().split('/').pop().split('?')[0];
  if(name==='stop')return route.fulfill({status:200,body:'{"ok":true}'});
  if(name==='index.m3u8'){
   if(!first)first=Date.now();
   const available=Math.min(names.length,Math.max(1,1+Math.floor((Date.now()-first)/900)));
   const body='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n'+
    names.slice(0,available).map(name=>'#EXTINF:1.000,\n'+name+'\n').join('');
   return route.fulfill({status:200,contentType:'application/vnd.apple.mpegurl',body});
  }
  if(segments[name])return route.fulfill({status:200,contentType:'video/mp2t',body:segments[name]});
  return route.fulfill({status:404,body:'missing segment'});
 });
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="movie"]').first().click();
 await page.locator('[data-details="movie:11"]').click();
 await page.locator('[data-watch="movie:11"]').first().click();
 await expect(page.locator('#player-root')).toBeVisible();
 await expect.poll(()=>page.locator('#player-media').evaluate(v=>v.readyState),{timeout:12000}).toBeGreaterThan(1);
 await expect.poll(()=>page.locator('#player-media').evaluate(v=>v.currentTime),{timeout:10000}).toBeGreaterThan(0.3);
 const state=await page.locator('#player-media').evaluate(v=>({ready:v.readyState,time:v.currentTime,error:v.error&&v.error.code,paused:v.paused}));
 console.log('BLOFY VOD HLS STATE',JSON.stringify({state,requests,errors}));
 expect(state.error).toBeFalsy();expect(errors).toEqual([]);
 await page.locator('#player-back').click();
 movie.container_extension='mp4';delete movie.duration_secs;
});

test('known-duration MKV uses full VOD HLS rather than a one-minute live-style preview',async({page})=>{
 movie.container_extension='mkv';movie.duration_secs=240;
 const raw=readFileSync('/tmp/blofy-qa-hls/index.m3u8','utf8');
 const names=[...new Set(raw.match(/seg-[0-9]{6}[.]ts/g)||[])];
 expect(names.length).toBeGreaterThanOrEqual(2);
 const segments={};for(const name of names)segments[name]=readFileSync('/tmp/blofy-qa-hls/'+name);
 const requests=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/vodfull/movie/11/mkv/0/240/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop();
  requests.push(name);
  if(name==='stop')return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  if(name==='index.m3u8'){
   const body='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n'+
    names.map(name=>'#EXTINF:1.000,\n'+name+'\n').join('')+'#EXT-X-ENDLIST\n';
   return route.fulfill({status:200,contentType:'application/vnd.apple.mpegurl',body});
  }
  if(segments[name])return route.fulfill({status:200,contentType:'video/mp2t',body:segments[name]});
  return route.fulfill({status:404,body:'missing full VOD segment'});
 });
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="movie"]').first().click();
 await page.locator('[data-details="movie:11"]').click();
 await page.locator('[data-watch="movie:11"]').first().click();
 await expect(page.locator('#player-root')).toBeVisible();
 await expect(page.locator('#player-mode-badge')).toContainText('VOD');
 await expect.poll(()=>requests.includes('index.m3u8'),{timeout:12000}).toBe(true);
 await expect.poll(()=>page.locator('#player-media').evaluate(v=>v.readyState),{timeout:16000}).toBeGreaterThan(1);
 const state=await page.locator('#player-media').evaluate(v=>({ready:v.readyState,error:v.error&&v.error.code}));
 expect(state.error).toBeFalsy();expect(errors).toEqual([]);
 movie.container_extension='mp4';delete movie.duration_secs;
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

test('web and remote navigation return to the previous screen; player can show real description',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.home-hero')).toBeVisible();
 await page.locator('[data-go="movie"]').first().click();
 await expect(page.locator('.poster-grid .poster')).toHaveCount(1);
 await page.locator('[data-details="movie:11"]').click();
 await expect(page.locator('.detail-title')).toHaveText('فيلم تجريبي');
 await expect(page.locator('.detail-plot')).toContainText('فيلم اختبار');
 await page.locator('[data-watch="movie:11"]').first().click();
 await expect(page.locator('#player-root')).toBeVisible();
 await page.locator('#player-info-toggle').click();
 await expect(page.locator('#player-info-panel')).toBeVisible();
 await expect(page.locator('#player-info-panel')).toContainText('فيلم اختبار');
 await page.goBack({waitUntil:'domcontentloaded'});
 await expect(page.locator('.detail-title')).toHaveText('فيلم تجريبي');
 await page.goBack({waitUntil:'domcontentloaded'});
 await expect(page.locator('.poster-grid .poster')).toHaveCount(1);
 expect(errors).toEqual([]);
});


test('native live dock matches Android controls, favors channels and surfs without mute button',async({page})=>{
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="live"]').first().click();
 await page.locator('[data-channel="31"]').click();
 await page.locator('#live-favorite').click();
 await expect(page.locator('#live-favorite')).toContainText('إزالة');
 await page.locator('[data-go="favorites"]').click();
 await expect(page.locator('.poster-grid .poster')).toHaveCount(1);
 await page.locator('[data-details="live:31"]').click();
 await expect(page.locator('#player-root')).toBeVisible();
 await expect(page.locator('#player-title-text')).toHaveText('قناة اختبار');
 await expect(page.locator('#player-mute')).toHaveCount(0);
 await expect(page.locator('.native-player-dock .native-player-control')).toHaveCount(7);
 await expect(page.locator('#player-audio')).toBeVisible();
 await expect(page.locator('#player-subtitles')).toBeVisible();
 await expect(page.locator('#player-quality')).toBeVisible();
 await expect(page.locator('#player-favorite')).toHaveAttribute('aria-pressed','true');
 await page.locator('#player-back').click();
 await expect(page.locator('.poster-grid .poster')).toHaveCount(1);
 await page.locator('[data-go="live"]').first().click();
 await page.locator('[data-channel="31"]').click();
 await page.locator('[data-preview-full]').click();
 await expect(page.locator('#player-channel-next')).toBeVisible();
 await page.locator('#player-channel-next').click();
 await expect(page.locator('#player-title-text')).toHaveText('قناة ثانية');
 await page.locator('#player-channel-prev').click();
 await expect(page.locator('#player-title-text')).toHaveText('قناة اختبار');
 await page.locator('#player-back').click();
 await expect(page.locator('.cat-rail')).toBeVisible();
 expect(errors).toEqual([]);
});

test('series episode rows preserve artwork fallback and back navigation',async({page})=>{
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="series"]').first().click();
 await page.locator('[data-details="series:21"]').click();
 await page.locator('[data-episodes="21"]').first().click();
 await expect(page.locator('.episode-row')).toHaveCount(1);
 await expect(page.locator('.episode-art .episode-cover')).toHaveCount(1);
 await expect(page.locator('.episode-art .episode-placeholder')).toHaveCount(1);
 await page.locator('.episode-row').first().focus();
 await page.keyboard.press('Escape');
 await expect(page.locator('.detail-title')).toHaveText('مسلسل تجريبي');
});


test('series player navigates both directions across available episodes',async({page})=>{
 const eps=[
  {id:55,title:'الحلقة الأولى',episode_num:1,container_extension:'mp4',info:{duration_secs:1800}},
  {id:56,title:'الحلقة الثانية',episode_num:2,container_extension:'mp4',info:{duration_secs:1800}}
 ];
 await page.route('**/api/catalog?*',async route=>{
  const u=new URL(route.request().url());
  if(u.searchParams.get('action')!=='get_series_info')return route.fallback();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   info:{cover:'https://example.com/show.jpg',plot:'مسلسل تجريبي'},episodes:{'1':eps}
  })});
 });
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="series"]').first().click();
 await page.locator('[data-details="series:21"]').click();
 await page.locator('[data-episodes="21"]').first().click();
 await expect(page.locator('.episode-row')).toHaveCount(2);
 await page.locator('[data-watch="series:55"]').click();
 await expect(page.locator('#player-title-text')).toContainText('الحلقة الأولى');
 const beforeLength=await page.evaluate(()=>history.length);
 await page.locator('#player-next-episode').click();
 await expect(page.locator('#player-title-text')).toContainText('الحلقة الثانية');
 expect(await page.evaluate(()=>history.length)).toBe(beforeLength);
 await expect(page.locator('#player-previous-episode')).toBeVisible();
 await page.locator('#player-previous-episode').click();
 await expect(page.locator('#player-title-text')).toContainText('الحلقة الأولى');
 expect(await page.evaluate(()=>history.length)).toBe(beforeLength);
 await page.locator('#player-back').click();
 await expect(page.locator('.episode-row')).toHaveCount(2);
});

test('poster loads a valid secondary cover if the primary Xtream icon fails',async({page})=>{
 const first=movie.stream_icon,second=movie.cover;
 movie.stream_icon='https://example.com/invalid-cover.jpg';
 movie.cover='https://example.com/alternate-cover.png';
 const tiny=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOQK3wAAAABJRU5ErkJggg==','base64');
 await page.route('https://example.com/alternate-cover.png',async route=>{
  await route.fulfill({status:200,contentType:'image/png',body:tiny});
 });
 await page.goto('http://127.0.0.1:3000/');
 const artwork=page.locator('.poster[data-details="movie:11"] .poster-art img').first();
 await expect(artwork).toBeVisible();
 await expect.poll(()=>artwork.getAttribute('src'),{timeout:7000}).toContain('alternate-cover.png');
 movie.stream_icon=first;
 if(second===undefined)delete movie.cover;else movie.cover=second;
});

test('movie player mirrors native 10-second transport and keeps advanced actions behind menu',async({page})=>{
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="movie"]').first().click();
 await page.locator('[data-details="movie:11"]').click();
 await page.locator('[data-watch="movie:11"]').first().click();
 await expect(page.locator('#player-root')).toBeVisible();
 await expect(page.locator('#player-mute')).toHaveCount(0);
 await expect(page.locator('.native-player-eyebrow')).toContainText('BLOFY CINEMA');
 await expect(page.locator('#player-skip-back')).toHaveAttribute('aria-label','رجوع 10 ثوانٍ');
 await expect(page.locator('#player-skip-forward')).toHaveAttribute('aria-label','تقديم 10 ثوانٍ');
 await expect(page.locator('.native-player-icon')).toHaveCount(7);
 await expect(page.locator('#player-more-panel')).toBeHidden();
 await page.locator('#player-options-toggle').click();
 await expect(page.locator('#player-more-panel')).toBeVisible();
 await expect(page.locator('#player-restart')).toBeVisible();
 await expect(page.locator('#player-jump-toggle')).toBeVisible();
 await page.locator('#player-options-toggle').click();
 await expect(page.locator('#player-more-panel')).toBeHidden();
 await page.locator('#player-favorite').click();
 await expect(page.locator('#player-favorite')).toHaveAttribute('aria-pressed','true');
 await page.locator('#player-favorite').click();
 await expect(page.locator('#player-favorite')).toHaveAttribute('aria-pressed','false');
});

test('remote OK opens in-player channel browser and Back dismisses it without stopping playback',async({page})=>{
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.goto('http://127.0.0.1:3000/');
 await page.locator('[data-go="live"]').first().click();
 await page.locator('[data-channel="31"]').click();
 await page.locator('[data-preview-full]').click();
 await expect(page.locator('#player-root')).toBeVisible();
 await page.locator('#player-media').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#player-channel-panel')).toBeVisible();
 await expect(page.locator('.native-channel-item')).toHaveCount(2);
 await expect(page.locator('.native-channel-item.selected')).toContainText('قناة اختبار');
 await page.keyboard.press('Escape');
 await expect(page.locator('#player-channel-panel')).toBeHidden();
 await expect(page.locator('#player-root')).toBeVisible();
 await page.locator('#player-media').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#player-channel-panel')).toBeVisible();
 await page.locator('[data-player-channel="32"]').click();
 await expect(page.locator('#player-channel-panel')).toBeHidden();
 await expect(page.locator('#player-title-text')).toHaveText('قناة ثانية');
 await page.locator('#player-media').focus();
 await page.keyboard.press('ArrowUp');
 await expect(page.locator('#player-audio')).toBeFocused();
 expect(errors).toEqual([]);
});

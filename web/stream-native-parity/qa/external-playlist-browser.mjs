import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const files={'/':'playlist-preview.html','/styles.css':'styles.css','/playlist-preview.css':'playlist-preview.css','/playlist-preview.js':'playlist-preview.js','/approved-m3u-loader.mjs':'approved-m3u-loader.mjs','/approved-m3u-catalog.mjs':'approved-m3u-catalog.mjs','/vendor/hls.min.js':'node_modules/hls.js/dist/hls.min.js'};
const provider='https://provider.example.com';
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/playlist-preview-policy'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({origins:[provider]}));return}
 if(!files[path]){res.writeHead(404).end();return}
 const mime=files[path].endsWith('.html')?'text/html':files[path].endsWith('.css')?'text/css':'application/javascript';
 res.setHeader('Content-Type',mime);
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' "+provider+"; media-src 'self' blob: "+provider+"; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
 res.end(readFileSync(files[path]));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const ctx=await browser.newContext({serviceWorkers:'block'}),page=await ctx.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin===origin)return route.continue();
  if(u.origin!==provider)return route.abort();
  requests.push({path:u.pathname,headers:route.request().headers()});
  const headers={'access-control-allow-origin':origin,'cache-control':'no-store'};
  if(u.pathname==='/catalog.m3u')return route.fulfill({status:200,headers,contentType:'text/plain',body:'#EXTM3U\n#EXTINF:-1 group-title="Fixtures",Red Channel\n/red/index.m3u8\n#EXTINF:-1 group-title="Fixtures",Blue Channel\n/blue/index.m3u8\n#EXTINF:-1,Blocked\nhttps://unapproved.example.com/no.m3u8'});
  if(/^\/(red|blue)\/(index\.m3u8|seg-\d+\.ts)$/.test(u.pathname))return route.fulfill({status:200,headers,contentType:u.pathname.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',body:readFileSync('qa-fixtures'+u.pathname)});
  return route.fulfill({status:404,headers});
 });
 await page.goto(origin);
 await page.waitForFunction(()=>!document.getElementById('playlist-load').disabled);
 await page.locator('#playlist-url').fill(provider+'/catalog.m3u?token=synthetic-secret');
 await page.locator('#playlist-load').click();
 await page.getByRole('button',{name:'Red Channel',exact:true}).waitFor();
 assert.equal(await page.locator('.playlist-item').count(),2);
 assert.equal(await page.locator('#playlist-url').inputValue(),'');
 await page.getByRole('button',{name:'Red Channel',exact:true}).click();
 async function picture(red){
  await page.waitForFunction(expected=>{
   const video=document.getElementById('playlist-video');if(video.readyState<2||video.currentTime<.4)return false;
   const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.drawImage(video,0,0,1,1);const [r,,b]=c.getImageData(0,0,1,1).data;
   return expected?r>b+70:b>r+70;
  },red,{timeout:20000});
 }
 await picture(true);
 await page.getByRole('button',{name:'Blue Channel',exact:true}).click();
 await picture(false);
 await page.locator('#playlist-query').fill('Blue');assert.equal(await page.locator('.playlist-item').count(),1);
 await page.locator('#playlist-clear').click();assert.equal(await page.locator('.playlist-item').count(),0);
 assert.ok(requests.some(x=>x.path==='/red/index.m3u8'));assert.ok(requests.some(x=>x.path==='/blue/index.m3u8'));
 for(const request of requests){assert.ok(!request.headers.cookie);assert.ok(!request.headers.referer)}
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 assert.deepEqual(errors,[]);
 console.log('BLOFY_EXTERNAL_PLAYLIST_BROWSER_PASS approved synthetic import, actual decoded red/blue pictures, search, clear');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}

import {test,expect} from '@playwright/test';
test.use({channel:'chrome'});

test('official Web 1.0 health, privacy headers and unauthenticated API boundary',async({page,request})=>{
 const health=await request.get('http://127.0.0.1:3000/health');
 expect(health.status()).toBe(200);
 const status=await health.json();
 expect(status).toMatchObject({ok:true,ready:true,app:'blofy-stream-web',version:'1.0.0'});
 for(const uri of ['/api/session','/api/page?kind=movie&offset=0&limit=36','/api/catalog?action=get_vod_streams']){
  const reply=await request.get('http://127.0.0.1:3000'+uri);
  expect(reply.status()).toBe(401);
  expect(reply.headers()['cache-control']).toContain('no-store');
 }
 const doc=await request.get('http://127.0.0.1:3000/');
 expect(doc.status()).toBe(200);
 expect(doc.headers()['content-security-policy']).toContain("script-src 'self'");
 expect(doc.headers()['content-security-policy']).toContain("object-src 'none'");
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
 expect(await page.title()).toBe('BLOFY STREAM — Web');
 await expect(page.locator('body')).toBeVisible();
});

test('offline-supplied MPEGTS engine is served by own origin; browser never needs a third-party script host',async({page,request})=>{
 const reply=await request.get('http://127.0.0.1:3000/vendor/mpegts.js');
 expect(reply.status()).toBe(200);
 expect(reply.headers()['content-type']).toContain('javascript');
 const js=await reply.body();
 expect(js.length).toBeGreaterThan(10000);
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
 await page.addScriptTag({url:'/vendor/mpegts.js'});
 expect(await page.evaluate(()=>typeof window.mpegts)).toBe('object');
 expect(await page.evaluate(()=>typeof window.mpegts.createPlayer)).toBe('function');
});

test('official PWA metadata matches brand and exposes no preview or testing label',async({request})=>{
 const response=await request.get('http://127.0.0.1:3000/manifest.webmanifest');
 expect(response.status()).toBe(200);
 const m=await response.json();
 expect(m.name).toBe('BLOFY STREAM');
 expect(m.display).toBe('standalone');
 expect(m.icons.length).toBeGreaterThan(0);
 expect(JSON.stringify(m)).not.toMatch(/preview|experimental|beta/i);
});

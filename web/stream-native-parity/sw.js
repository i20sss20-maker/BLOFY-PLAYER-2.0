/* BLOFY STREAM application shell only — never cache subscriptions, media or API.
 * Network-first ensures freshly deployed app assets appear immediately.
 * Offline copies allow the interface to open; protected content still needs auth.
 */
const CACHE_NAME='blofy-stream-shell-v5';
const SHELL=['/','/app.js','/profile-transfer.js','/playback-acceptance.js','/styles.css','/stream-icon.svg','/apple-touch-icon.png','/icon-192.png','/icon-512.png','/manifest.webmanifest'];
self.addEventListener('install',function(event){
 event.waitUntil((async function(){
  const cache=await caches.open(CACHE_NAME);
  await Promise.all(SHELL.map(async function(path){
   try{
    const response=await fetch(path,{cache:'no-store',credentials:'same-origin'});
    if(response.ok)await cache.put(path,response)
   }catch(e){}
  }));
  await self.skipWaiting()
 })())
});
self.addEventListener('activate',function(event){
 event.waitUntil((async function(){
  const names=await caches.keys();
  await Promise.all(names.filter(function(name){return name.indexOf('blofy-stream-shell-')===0&&name!==CACHE_NAME})
   .map(function(name){return caches.delete(name)}));
  await self.clients.claim()
 })())
});
self.addEventListener('fetch',function(event){
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 if(SHELL.indexOf(url.pathname)<0)return; // Explicitly exclude /api, /vendor and video.
 event.respondWith((async function(){
  const cache=await caches.open(CACHE_NAME);
  try{
   const fresh=await fetch(request,{cache:'no-store'});
   if(fresh.ok)await cache.put(url.pathname,fresh.clone());
   return fresh
  }catch(e){
   const cached=await cache.match(url.pathname);
   return cached||new Response('BLOFY STREAM is offline',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})
  }
 })())
});

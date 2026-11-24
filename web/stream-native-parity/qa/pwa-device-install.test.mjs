import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

const root=new URL('../',import.meta.url);
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const style=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const start=app.indexOf('function webAppInstallGuide(');
const end=app.indexOf('function installedWebApp(',start);
assert.ok(start>0&&end>start);
const guide=vm.runInNewContext(app.slice(start,end)+';webAppInstallGuide',{String});

test('iOS installed app is standalone and never has a fake install prompt',()=>{
 const ios=guide('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)',false,false);
 assert.equal(ios.mode,'ios');
 assert.match(ios.message,/Safari/);
 assert.match(ios.message,/فتح كتطبيق/);
 assert.equal(guide('iPhone',true,false).mode,'installed');
 assert.equal(guide('VIDAA',true,false).mode,'installed');
});
test('Android supports actual user-initiated install or manual menu guidance',()=>{
 assert.equal(guide('Android Chrome',false,true).mode,'prompt');
 assert.equal(guide('Android Chrome',false,false).mode,'android');
 assert.equal(guide('Windows NT 10.0',false,false).mode,'browser');
});
test('VIDAA/Toshiba is a web app/browser favorite, never a fake native sideload',()=>{
 const tv=guide('Toshiba VIDAA',false,true);
 assert.equal(tv.mode,'tv');
 assert.match(tv.message,/متصفح التلفزيون/);
 assert.match(tv.message,/عبر المنصة/);
});
test('PWA includes standalone metadata, a real PNG icon, secure server route',()=>{
 assert.match(index,/name="apple-mobile-web-app-capable" content="yes"/);
 assert.match(index,/name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
 assert.match(index,/rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/);
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.scope,'/');
 assert.ok(manifest.icons.some(x=>x.src==='/stream-icon.svg'));
 assert.ok(manifest.icons.some(x=>x.src==='/icon-192.png'&&x.sizes==='192x192'&&x.type==='image/png'));
 assert.ok(manifest.icons.some(x=>x.src==='/icon-512.png'&&x.sizes==='512x512'&&x.type==='image/png'));
 assert.match(server,/p==='\/apple-touch-icon\.png'/);
 assert.match(server,/p==='\/icon-192\.png'/);
 assert.match(server,/p==='\/icon-512\.png'/);
 assert.match(server,/\(p==='\/apple-touch-icon\.png'\|\|p==='\/icon-192\.png'\|\|p==='\/icon-512\.png'\)\?'image\/png'/);
 assert.match(sw,/blofy-stream-shell-v4/);
 assert.match(sw,/\/apple-touch-icon\.png/);
 assert.match(sw,/if\(SHELL\.indexOf\(url\.pathname\)<0\)return/,'service worker fetch interception is limited to shell files');
});
test('home-screen install entry is optional and exposes accessible status',()=>{
 assert.match(app,/id="install-blofy-web"/);
 assert.match(app,/id="install-blofy-help" role="status" aria-live="polite"/);
 assert.match(app,/beforeinstallprompt/);
 assert.match(app,/request\.prompt\(\)/);
 assert.match(app,/appinstalled/);
 assert.match(style,/safe-area-inset-bottom/);
 assert.match(style,/touch-action:manipulation/);
});

test('all three PNG icons have correct dimensions and fully decompress',()=>{
 for(const size of [180,192,512]){
  const name=size===180?'apple-touch-icon.png':'icon-'+size+'.png';
  const bytes=readFileSync(new URL('../'+name,import.meta.url));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',name);
  assert.equal(bytes.readUInt32BE(16),size,name+' width');
  assert.equal(bytes.readUInt32BE(20),size,name+' height');
  let offset=8,compressed=[];
  while(offset+12<=bytes.length){
   const len=bytes.readUInt32BE(offset),tag=bytes.toString('ascii',offset+4,offset+8);
   assert.ok(offset+len+12<=bytes.length,name+' chunk bounds');
   if(tag==='IDAT')compressed.push(bytes.subarray(offset+8,offset+8+len));
   offset+=len+12;
   if(tag==='IEND')break;
  }
  assert.ok(compressed.length>0,name+' has compressed image data');
  const data=inflateSync(Buffer.concat(compressed));
  assert.ok(data.length>size*size/3,name+' decompresses into pixel rows');
 }
});

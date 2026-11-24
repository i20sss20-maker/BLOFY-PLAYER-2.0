import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

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
 assert.match(server,/p==='\/apple-touch-icon\.png'/);
 assert.match(server,/p==='\/apple-touch-icon\.png'\?'image\/png'/);
 assert.match(sw,/blofy-stream-shell-v4/);
 assert.match(sw,/\/apple-touch-icon\.png/);
 assert.doesNotMatch(sw,/\/api\/|\/api\//,'service worker never caches API paths');
});
test('home-screen install entry is optional and exposes accessible status',()=>{
 assert.match(app,/id=\\"install-blofy-web\\"/);
 assert.match(app,/id=\\"install-blofy-help\\" role=\\"status\\" aria-live=\\"polite\\"/);
 assert.match(app,/beforeinstallprompt/);
 assert.match(app,/request\.prompt\(\)/);
 assert.match(app,/appinstalled/);
 assert.match(style,/safe-area-inset-bottom/);
 assert.match(style,/touch-action:manipulation/);
});

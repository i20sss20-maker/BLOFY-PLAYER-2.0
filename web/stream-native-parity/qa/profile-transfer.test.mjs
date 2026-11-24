import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const transfer=require('../profile-transfer.js');
const fixed=1795500000000;
const fav={
 'movie:11':true,'series:21':true,'live:31':true,
 'movie:0':true,'__proto__':true,'movie:bad':true
};
const meta={
 'movie:11':{name:'فيلم تجريبي',stream_icon:'https://source.example.com/auth=secret?token=TOPSECRET',container_extension:'mp4'},
 'series:21':{name:'مسلسل عربي',container_extension:'mkv'},
 'live:31':{name:'خبر: https://example.com/hidden/user:password',container_extension:'ts'}
};
const watched={
 'movie:11':{position:600,duration:7200,updated:fixed-60000,name:'فيلم تجريبي',ext:'mp4',art:'https://secret.example.com/private.mp4'},
 'series:55':{position:350,duration:1400,updated:fixed-1000,name:'الحلقة الخامسة',ext:'mkv',seriesId:'21'},
 'live:31':{position:60,duration:100,updated:fixed,name:'live'}
};
test('export only contains user-visible title, valid gateway IDs and checkpoints; never media secrets',()=>{
 const serialized=transfer.create(fav,watched,meta,fixed);
 assert.doesNotMatch(serialized,/TOPSECRET|secret\.example|source\.example|private\.mp4|auth=|token=|password|deviceKey|Bearer/);
 const exported=JSON.parse(serialized);
 assert.equal(exported.format,'blofy-stream-web-portable-profile');
 assert.equal(exported.version,1);
 assert.equal(exported.favorites.length,3);
 assert.equal(exported.watch.length,2);
 assert.equal(exported.favorites.find(x=>x.key==='live:31').name,'');
 assert.equal(exported.watch.find(x=>x.key==='series:55').position,350);
 assert.equal(exported.watch.find(x=>x.key==='live:31'),undefined);
});
test('parse strictly refuses foreign versions, invalid keys, duplicates, oversized arrays, poisoned schema',()=>{
 const data=JSON.parse(transfer.create(fav,watched,meta,fixed));
 for(const changes of [
  {format:'other'}, {version:2}, {favorites:[] ,watch:{}},
  {favorites:[...data.favorites,data.favorites[0]]},
  {watch:[...data.watch,data.watch[0]]},
  {watch:[{...data.watch[0],position:999999}]},
  {watch:[{...data.watch[0],duration:500}]},
  {watch:[{...data.watch[0],key:'live:31'}]},
  {favorites:[{key:'__proto__',name:'attack',ext:'mp4'}]},
  {password:'must never be imported'},
  {favorites:new Array(301).fill(data.favorites[0])}
 ]){
  const testData={...data,...changes};
  assert.throws(()=>transfer.parse(JSON.stringify(testData),fixed),/profile_/,JSON.stringify(changes).slice(0,130));
 }
 assert.throws(()=>transfer.parse('{broken',fixed),/profile_/);
 assert.throws(()=>transfer.parse('x'.repeat(250000),fixed),/profile_/);
});
test('manual import is non-destructive: preserve newer watch checkpoint, union favorites, no artwork URLs',()=>{
 const exported=transfer.parse(transfer.create(fav,watched,meta,fixed),fixed);
 const newer={'movie:11':{position:995,duration:7200,updated:fixed+10000,name:'newer local',ext:'mp4',art:'local://do-not-overwrite'}};
 const existingFav={'movie:11':true};
 const existingItems={'movie:11':{id:'11',name:'rich saved',stream_icon:'https://images.example/img.jpg'}};
 const result=transfer.merge(existingFav,newer,existingItems,exported);
 assert.equal(result.stats.newFavorites,2);
 assert.equal(result.stats.newCheckpoints,1);
 assert.equal(result.stats.preservedCheckpoints,1);
 assert.equal(result.watch['movie:11'].position,995);
 assert.equal(result.watch['series:55'].position,350);
 assert.equal(result.watch['series:55'].art,'');
 assert.equal(result.favoriteItems['movie:11'].name,'rich saved');
 assert.equal(result.favoriteItems['live:31'].id,'31');
 assert.equal(result.favoriteItems['live:31'].stream_icon,'');
 assert.equal(result.favorites['live:31'],true);
 assert.equal(newer['series:55'],undefined,'never mutate the old state');
});
test('import newer checkpoint beats older saved local checkpoint without deleting unrelated data',()=>{
 const backup=transfer.parse(transfer.create(fav,watched,meta,fixed),fixed);
 const local={'movie:11':{position:50,updated:fixed-100000},'series:78':{position:300,updated:fixed}};
 const merged=transfer.merge({},local,{},backup);
 assert.equal(merged.stats.updatedCheckpoints,1);
 assert.equal(merged.watch['movie:11'].position,600);
 assert.equal(merged.watch['series:78'].position,300);
});
test('app settings guard file save by epoch and exact profile, and avoid remote profile upload',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const srv=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(app,/profile-import-accept/);
 assert.match(app,/importEpoch!==S\.accountEpoch\|\|importProfile!==S\.profileKey/);
 assert.match(app,/old\.push\(\{key:key,value:localStorage\.getItem\(key\)\}\)/);
 assert.match(app,/localStorage\.setItem\(profileStorageKey\(updates\[w\]\[0\]\)/);
 assert.doesNotMatch(app,/api\('POST','\/api\/profile-transfer/);
 assert.match(srv,/p==='\/profile-transfer\.js'/);
 assert.match(html,/<script src="\/profile-transfer\.js"><\/script>[\s\S]*<script src="\/app\.js"><\/script>/);
 assert.match(docker,/COPY server\.ts index\.html app\.js profile-transfer\.js/);
 assert.match(sw,/\/profile-transfer\.js/);
});

import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const manifest=JSON.parse(readFileSync('manifest.webmanifest','utf8'));
const html=readFileSync('index.html','utf8');
const sw=readFileSync('sw.js','utf8');
test('all PWA icons exist in actual runtime image and PNG dimensions match the declared sizes',()=>{
 for(const icon of [...manifest.icons,{src:'/apple-touch-icon.png',sizes:'180x180',type:'image/png'}]){
  const name=icon.src.slice(1);
  assert.ok(existsSync(name),name+' missing');
  const bytes=readFileSync(name);
  if(icon.type==='image/png'){
   assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   const [w,h]=icon.sizes.split('x').map(Number);
   assert.equal(bytes.readUInt32BE(16),w);
   assert.equal(bytes.readUInt32BE(20),h);
  }
 }
 assert.match(html,/rel="apple-touch-icon"/);
});
test('PWA shell refresh keeps authenticated APIs and media out of cache',()=>{
 assert.match(sw,/blofy-stream-shell-v19/);
 const paths=JSON.parse(sw.match(/const SHELL=(\[[^\n]+\]);/)[1].replaceAll("'",'"'));
 for(const path of paths){
  assert.ok(!/^\/(?:api|vendor)\//.test(path));
  if(path!=='/')assert.ok(existsSync(path.slice(1)),path+' missing');
 }
 assert.match(sw,/cache:'no-store'/);
 assert.match(sw,/name!==CACHE_NAME/);
});

test('fresh app navigation versions all shell scripts and styles',()=>{
 for(const asset of ['styles.css','profile-transfer.js','playback-acceptance.js','app.js']){
  assert.ok(html.includes('/'+asset+'?v=2026.11.28.56.0.3'));
 }
});

test('native Arabic fonts are packaged and served locally',()=>{
 const css=readFileSync('styles.css','utf8'),server=readFileSync('server.ts','utf8'),docker=readFileSync('Dockerfile','utf8');
 for(const name of ['IBMPlexSansArabic-Regular.ttf','IBMPlexSansArabic-SemiBold.ttf']){
  assert.ok(existsSync('fonts/'+name));
  assert.ok(css.includes('/fonts/'+name));
  assert.ok(server.includes('/fonts/'+name));
  assert.equal(readFileSync('fonts/'+name).subarray(0,4).toString('hex'),'00010000');
 }
 assert.ok(docker.includes('COPY fonts/ /app/fonts/'));
});

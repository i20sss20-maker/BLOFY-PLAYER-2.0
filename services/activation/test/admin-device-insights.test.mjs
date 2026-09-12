import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import pg from 'pg';
import {insightOptions,safeDeviceInsight,loadDeviceInsights,renderDeviceInsights,createDeviceInsightsHandler,DEVICE_INSIGHTS_PATH} from '../src/admin-device-insights.mjs';
const now=Date.now();
const row={device_id:'BLOFY-TEST-NEW1',created_at:new Date(now-60000),status:'trial',expires_at:new Date(now+2*86400000),last_app_version:'2.0.0-rc07.40',activation_code:'must-not-leak',password_enc:'also-secret'};
test('new means first registration under 24 hours, not last contact',()=>{
 assert.equal(safeDeviceInsight(row,now).isNew,true);
 assert.equal(safeDeviceInsight({...row,created_at:new Date(now-2*86400000),last_seen_at:new Date(now)},now).isNew,false);
 assert.equal(safeDeviceInsight({...row,created_at:new Date(now+60000)},now).isNew,false);
});
test('bounded allowlisted filters cannot become SQL identifiers',()=>{
 for(const input of ['filter=__proto__&sort=constructor','filter=all%27%3BDROP+TABLE+devices&sort=evil','page=NaN'])assert.deepEqual(insightOptions(new URLSearchParams(input)),{filter:'all',sort:'newest',page:1,q:''});
 assert.equal(insightOptions(new URLSearchParams('page=999999')).page,1000);
});
test('sensitive fields are omitted and web portal is never labelled app version',()=>{
 const safe=safeDeviceInsight({...row,last_app_version:'web-portal'},now);
 assert.equal(safe.appVersion,null);assert.equal(safe.activation_code,undefined);assert.equal(JSON.stringify(safe).includes('secret'),false);
});
test('expired and lifetime states are distinguished',()=>{
 assert.equal(safeDeviceInsight({...row,expires_at:new Date(now-1)},now).status,'expired');
 assert.equal(safeDeviceInsight({...row,status:'active',expires_at:null},now).lifetime,true);
 assert.equal(safeDeviceInsight({...row,status:'blocked',expires_at:null},now).lifetime,false);
});
test('page is fully rendered, escapes text, has no scripts or contact-now claim',()=>{
 const html=renderDeviceInsights({options:{q:'"><script>alert(1)</script>',filter:'all',sort:'newest',page:1},counts:{total:1},items:[safeDeviceInsight({...row,device_id:'<img src=x onerror=alert(1)>'},now)],hasMore:false});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('أول تسجيل'));assert.ok(html.includes('لا يثبت أن الجهاز متصل الآن'));
});
test('search terms remain query parameters; returned rows do not leak credentials',async()=>{
 const calls=[];const pool={query:async(sql,values)=>{calls.push({sql,values});return {rows:values?[row]:[{total:1}]};}};
 const q="';DROP TABLE devices;--";
 const data=await loadDeviceInsights(pool,{q,filter:'all',sort:'newest',page:1},now);
 assert.ok(!calls[0].sql.includes(q));assert.equal(calls[0].values[0],q);assert.equal(data.items[0].activation_code,undefined);
});
test('unauthorized and mutating HTTP requests never reach database',async t=>{
 let queries=0;const pool={query:async(sql,values)=>{queries++;return {rows:values?[row]:[{total:1}]};}};
 const handle=createDeviceInsightsHandler({pool,adminToken:'unit-only-token',now:()=>now});
 const server=http.createServer(async(req,res)=>{if(!await handle(req,res)){res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+DEVICE_INSIGHTS_PATH)).status,401);
 assert.equal((await fetch(base+DEVICE_INSIGHTS_PATH,{method:'POST',headers:{authorization:'Bearer unit-only-token'}})).status,405);assert.equal(queries,0);
 const r=await fetch(base+DEVICE_INSIGHTS_PATH,{headers:{authorization:'Bearer unit-only-token'}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.match(await r.text(),/BLOFY-TEST-NEW1/);
});
test('PostgreSQL filters and real admin session work without mutating device records',{skip:!process.env.BLOFY_TEST_DATABASE_URL},async()=>{
 const database=process.env.BLOFY_TEST_DATABASE_URL;
 const url=new URL(database);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname.includes('blofy_sync_test'),'isolated test database only');
 const pool=new pg.Pool({connectionString:database});
 const deviceId='BLOFY-INSIGHT-'+crypto.randomBytes(4).toString('hex').toUpperCase();
 const env={...process.env,DATABASE_URL:database,PGSSLMODE:'disable',PORT:'8095',BLOFY_ADMIN_TOKEN:'ci-only-admin-token-with-32-characters',BLOFY_ADMIN_USERNAME:'ci-insights',BLOFY_ADMIN_PASSWORD:'ci-only-password',BLOFY_PLAYLIST_ENCRYPTION_KEY:'b'.repeat(64)};
 let server,logs='';
 try {
  server=spawn(process.execPath,['src/bootstrap.mjs'],{env,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',x=>{logs+=x;});server.stderr.on('data',x=>{logs+=x;});
  const base='http://127.0.0.1:8095';let ready=false;
  for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error('test service exited: '+logs);try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await wait(150);}
  assert.ok(ready,'test service starts');
  await pool.query("INSERT INTO devices(device_id,activation_code,status,expires_at,last_app_version,last_platform) VALUES($1,'123456','trial',NOW()+INTERVAL '2 days','2.0.0-rc07.40','android')",[deviceId]);
  const before=(await pool.query('SELECT * FROM devices WHERE device_id=$1',[deviceId])).rows[0];
  for(const filter of ['all','new24','new7','trial','empty']) {
   const data=await loadDeviceInsights(pool,{q:deviceId,filter,sort:'newest',page:1});
   assert.equal(data.items.length,1);assert.equal(data.items[0].isNew,true);assert.equal(data.items[0].playlistCount,0);
  }
  for(const filter of ['active','lifetime','expiring','expired','blocked','errors']) {
   const data=await loadDeviceInsights(pool,{q:deviceId,filter,sort:'expiry',page:1});
   assert.equal(data.items.length,filter==='expiring'?1:0,filter);
  }
  assert.equal((await loadDeviceInsights(pool,{q:deviceId,filter:'all',sort:'seen',page:2})).items.length,0);
  assert.equal((await fetch(base+DEVICE_INSIGHTS_PATH)).status,401);
  const login=await fetch(base+'/api/v1/admin/session/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:env.BLOFY_ADMIN_USERNAME,password:env.BLOFY_ADMIN_PASSWORD})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+DEVICE_INSIGHTS_PATH+'?q='+encodeURIComponent(deviceId),{headers:{cookie}});
  assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(deviceId));assert.ok(html.includes('جهاز جديد'));assert.ok(!html.includes('123456'));
  const admin=await fetch(base+'/admin',{headers:{cookie}});assert.match(await admin.text(),/معلومات الأجهزة والجديد منها/);
  assert.deepEqual((await pool.query('SELECT * FROM devices WHERE device_id=$1',[deviceId])).rows[0],before);
 }finally{
  if(server){server.kill('SIGTERM');await wait(250);if(server.exitCode===null)server.kill('SIGKILL');}
  await pool.query('DELETE FROM devices WHERE device_id=$1',[deviceId]).catch(()=>{});await pool.end();
 }
});

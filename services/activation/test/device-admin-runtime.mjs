/** Isolated PostgreSQL + real HTTP session integration. Never use production data. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import pg from 'pg';
const url=process.env.BLOFY_TEST_DATABASE_URL;
if(!url || !['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test')) throw new Error('A dedicated local *_test database is required.');
const base='http://127.0.0.1:8098';
const env={...process.env,DATABASE_URL:url,PGSSLMODE:'disable',PORT:'8098',BLOFY_ADMIN_TOKEN:'test-only-device-admin-secret-32chars',BLOFY_ADMIN_USERNAME:'device-test',BLOFY_ADMIN_PASSWORD:'test-only-password',BLOFY_PLAYLIST_ENCRYPTION_KEY:'9'.repeat(64)};
let log='';const server=spawn(process.execPath,['src/bootstrap.mjs'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
const pool=new pg.Pool({connectionString:url,ssl:false});
try{
 let ready=false;for(let n=0;n<60;n++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw new Error(log);await wait(250);}assert.ok(ready,'server readiness');
 const beforeRelease=(await (await fetch(base+'/health')).json()).release.app;
 let r=await fetch(base+'/api/v1/admin/session/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username:env.BLOFY_ADMIN_USERNAME,password:env.BLOFY_ADMIN_PASSWORD})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json'};
 const request=async(path,method='GET',body,override={})=>{const response=await fetch(base+path,{method,headers:{...headers,...override},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,headers:response.headers,data:await response.json()};};
 const root='/api/v1/admin/device-insights';assert.equal((await fetch(base+root)).status,401);assert.equal((await request(root)).status,200);
 await pool.query(`INSERT INTO devices(device_id,activation_code,status,created_at,trial_started_at,expires_at,last_seen_at,last_app_version,last_platform)
 SELECT 'BLOFY-CITEST-'||lpad(n::text,4,'0'),'123456',CASE WHEN n=2 THEN 'active' WHEN n=3 THEN 'blocked' ELSE 'trial' END,
 CASE WHEN n=1 THEN NOW()-INTERVAL '1 hour' ELSE NOW()-INTERVAL '10 days' END,NOW()-INTERVAL '10 days',
 CASE WHEN n=2 THEN NOW()-INTERVAL '1 day' ELSE NOW()+INTERVAL '3 days' END,
 CASE WHEN n=1 THEN NOW() ELSE NOW()-INTERVAL '8 days' END,'2.0.0-rc07.40','android' FROM generate_series(1,53) n`);
 const id='BLOFY-CITEST-0001';const old=(await pool.query('SELECT * FROM devices WHERE device_id=$1',[id])).rows[0];
 await pool.query(`INSERT INTO device_playlists(id,device_id,name,provider_type,base_url_enc,username_enc,password_enc,active) VALUES('01234567-1234-4234-8234-123456789abc',$1,'قائمة اختبار','xtream','sealed','sealed','sealed',TRUE)`,[id]);
 let data=await request(root+'?q=CITEST');assert.equal(data.data.total,53);assert.equal(data.data.items.length,50);assert.match(data.headers.get('cache-control'),/no-store/);
 data=await request(root+'?q=CITEST&page=2');assert.equal(data.data.items.length,3);
 data=await request(root+'?q=CITEST&filter=new24h');assert.deepEqual(data.data.items.map(x=>x.deviceId),[id]);assert.equal(data.data.items[0].playlistCount,1);
 data=await request(root+'?q=CITEST&filter=noPlaylists');assert.equal(data.data.total,52);
 data=await request(root+'?q=CITEST&filter=expired');assert.equal(data.data.total,1);assert.equal(data.data.items[0].deviceId,'BLOFY-CITEST-0002');
 data=await request(root+'?q=CITEST&filter=recent');assert.equal(data.data.total,1);
 data=await request(root+'?q=CITEST&filter=expiring7d');assert.equal(data.data.total,51);
 data=await request(root+'?q=CITEST&version=2.0.0-rc07.39');assert.equal(data.data.total,0);
 data=await request(root+'?q=%25');assert.equal(data.data.total,0,'literal wildcard, no SQL broadening');
 const profile={name:'عميل جديد',phone:'0501234567',email:'customer@example.invalid',notes:'متابعة داخلية',expectedRevision:0};
 assert.equal((await request(root+'/'+id,'PATCH',profile,{cookie:''})).status,401);
 assert.equal((await request(root+'/'+id,'PATCH',profile,{origin:'https://foreign.invalid'})).status,403);
 assert.equal((await request(root+'/'+id,'PATCH',null)).status,400);
 assert.equal((await request(root+'/'+id,'PATCH',profile)).status,200);
 data=await request(root+'/'+id);assert.equal(data.data.name,profile.name);assert.equal(data.data.notes,profile.notes);assert.equal(data.data.revision,1);assert.equal(data.data.firstSeenAt,new Date(old.created_at).getTime());
 assert.equal((await request(root+'/'+id,'PATCH',profile)).status,409,'stale edit blocked');
 const competing=await Promise.all([request(root+'/'+id,'PATCH',{...profile,notes:'A',expectedRevision:1}),request(root+'/'+id,'PATCH',{...profile,notes:'B',expectedRevision:1})]);assert.deepEqual(competing.map(x=>x.status).sort(),[200,409]);
 let detail=(await request(root+'/'+id)).data;const expires=detail.expiresAt;
 assert.equal((await request(root+'/'+id+'/status','POST',{action:'block',expectedStatus:detail.rawStatus,expectedExpiresAt:expires})).status,200);
 detail=(await request(root+'/'+id)).data;assert.equal(detail.status,'blocked');assert.equal(detail.expiresAt,expires);assert.equal(detail.playlistCount,1);
 assert.equal((await request(root+'/'+id+'/status','POST',{action:'unblock',expectedStatus:'trial',expectedExpiresAt:expires})).status,409);
 assert.equal((await request(root+'/'+id+'/status','POST',{action:'unblock',expectedStatus:'blocked',expectedExpiresAt:expires})).status,200);
 detail=(await request(root+'/'+id)).data;assert.equal(detail.rawStatus,'trial');assert.equal(detail.expiresAt,expires);
 let imported=(await request(root+'/BLOFY-CITEST-0003')).data;
 assert.equal((await request(root+'/BLOFY-CITEST-0003/status','POST',{action:'unblock',expectedStatus:'blocked',expectedExpiresAt:imported.expiresAt})).status,409,'unknown old blocked state cannot grant entitlement');
 assert.equal((await request(root+'/BLOFY-MISSING-0000')).status,404);
 assert.equal((await request(root,'DELETE')).status,400);
 const audit=await pool.query('SELECT action FROM device_audit WHERE device_id=$1',[id]);assert.ok(audit.rows.some(x=>x.action==='customer_profile_updated'));assert.ok(audit.rows.some(x=>x.action==='device_blocked'));
 const after=(await pool.query('SELECT * FROM devices WHERE device_id=$1',[id])).rows[0];assert.equal(after.activation_code,old.activation_code);assert.equal(+after.created_at,+old.created_at);assert.equal(+after.expires_at,+old.expires_at);
 const customer=await request('/api/v1/admin/experience/customer?deviceId='+id);assert.equal(customer.status,200);assert.equal(customer.data.customer.name,profile.name);
 for(const path of ['/admin','/portal','/releases','/device-admin.css','/experience.js'])assert.equal((await fetch(base+path,{headers})).status,200,path);
 assert.deepEqual((await (await fetch(base+'/health')).json()).release.app,beforeRelease);
 console.log('PASS: registration dates, filter/count/pagination, Arabic profile, audit, authorization/CSRF, concurrency, block/unblock preserves expiry and playlists; release and portal routes unchanged.');
}finally{await pool.query("DELETE FROM devices WHERE device_id LIKE 'BLOFY-CITEST-%'").catch(()=>{});await pool.end();server.kill('SIGTERM');await wait(250);if(server.exitCode===null)server.kill('SIGKILL');}

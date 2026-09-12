import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import pg from 'pg';

// This suite creates synthetic records. It must never point at a customer database.
const database = process.env.BLOFY_TEST_DATABASE_URL;
if (!database || !['127.0.0.1','localhost'].includes(new URL(database).hostname) ||
    !new URL(database).pathname.includes('blofy_sync_test')) throw new Error('Isolated local blofy_sync_test database required.');
const pool = new pg.Pool({ connectionString: database });
const base = 'http://127.0.0.1:8096';
const keyHex = 'b'.repeat(64), key = Buffer.from(keyHex, 'hex');
const deviceId = 'BLOFY-CI-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const activationCode = '234567', credentials = {deviceId, activationCode};
const env = {...process.env, DATABASE_URL:database, PGSSLMODE:'disable', PORT:'8096',
  BLOFY_ADMIN_TOKEN:'ci-only-admin-token-with-32-characters', BLOFY_ADMIN_USERNAME:'ci-sync', BLOFY_ADMIN_PASSWORD:'ci-password',
  BLOFY_SUBSCRIBER_HOST:'https://subscriber.example/base', BLOFY_PLAYLIST_ENCRYPTION_KEY:keyHex};
let child, logs='';
async function start(baseline=false) {
  logs='';
  const args = baseline ? ['--input-type=module','-e',
    "import './src/subscriber-proxy-hook.mjs';import './src/subscriber-portal-ui-hook.mjs';import './src/admin-session-hook.mjs';import './src/admin-console-hook.mjs';await import('./src/server.mjs');"] : ['src/bootstrap.mjs'];
  child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
  for(let attempt=0;attempt<60;attempt++) {
    if(child.exitCode!==null)throw new Error('Test service exited: '+logs);
    try { if((await fetch(base+'/health')).ok)return; }catch{}
    await wait(150);
  }
  throw new Error('Test service did not start: '+logs);
}
async function stop() {
  if(!child || child.exitCode!==null)return;
  child.kill('SIGTERM');for(let n=0;n<25 && child.exitCode===null;n++)await wait(100);
  if(child.exitCode===null){child.kill('SIGKILL');await wait(100);}
}
function token(extra={}) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const payload={u:'ci-provider-user',p:'ci-only-provider-password',d:deviceId,exp:Date.now()+60000,...extra};
  const data=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}
const post=async(path,body,method='POST')=>{
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,headers:response.headers,data:await response.json()};
};
try {
  await start(true);
  const before=await post('/api/v1/subscribers/resolve',{...credentials,sessionTokens:[token()]});
  assert.equal(before.status,404,'reproduce the missing endpoint on the pre-fix website stack');
  await stop();await start();
  assert.equal((await fetch(base+'/api/v1/subscribers/resolve')).status,405);
  let response=await post('/api/v1/activation/check',{...credentials,appVersion:'2.0.0-rc07.40',platform:'android'});
  assert.equal(response.status,200);assert.equal(response.data.status,'trial');
  const direct={id:crypto.randomUUID(),name:'قائمة Xtream اختبار',providerType:'xtream',baseUrl:'https://provider.example',username:'ordinary-user',password:'ordinary-test-password',active:true};
  const sessionToken=token();
  const subscriber={id:crypto.randomUUID(),name:'مشتركين BLOFY اختبار',providerType:'xtream',baseUrl:'https://blofy.invalid/api/v1/subscribers/xtream',username:sessionToken,password:'blofy',active:false};
  for(const item of [direct,subscriber])assert.equal((await post('/api/v1/portal/playlists',{...credentials,...item})).status,200);
  const list=await post('/api/v1/portal/playlists/list',credentials);assert.equal(list.status,200);assert.equal(list.data.items.length,2);
  const remoteSubscriber=list.data.items.find(x=>x.id===subscriber.id);assert.equal(remoteSubscriber.username,sessionToken);
  const deviceBefore=(await pool.query('SELECT activation_code,status,expires_at FROM devices WHERE device_id=$1',[deviceId])).rows[0];
  const rowsBefore=(await pool.query('SELECT * FROM device_playlists WHERE device_id=$1 ORDER BY id',[deviceId])).rows;
  response=await post('/api/v1/subscribers/resolve',{...credentials,sessionTokens:[remoteSubscriber.username,token({exp:Date.now()-60000})]});
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(response.data.items.length,2);
  for(const item of response.data.items) {
    assert.equal(item.delivery,'direct');assert.equal(item.baseUrl,'https://subscriber.example/base');
    assert.equal(item.username,'ci-provider-user');assert.equal(item.password,'ci-only-provider-password');assert.ok(item.sessionToken);
  }
  assert.deepEqual((await pool.query('SELECT activation_code,status,expires_at FROM devices WHERE device_id=$1',[deviceId])).rows[0],deviceBefore);
  assert.deepEqual((await pool.query('SELECT * FROM device_playlists WHERE device_id=$1 ORDER BY id',[deviceId])).rows,rowsBefore);
  response=await post('/api/v1/subscribers/resolve',{...credentials,sessionTokens:[token({d:'BLOFY-ANOTHER-DEVICE'}),'invalid-token',sessionToken]});
  assert.equal(response.status,200);assert.equal(response.data.items[0].error,'invalid_subscriber_session');assert.equal(response.data.items[1].error,'invalid_subscriber_session');assert.equal(response.data.items[2].delivery,'direct');
  await pool.query("UPDATE devices SET status='blocked' WHERE device_id=$1",[deviceId]);
  response=await post('/api/v1/subscribers/resolve',{...credentials,sessionTokens:[sessionToken]});assert.equal(response.status,403);assert.equal(response.data.items,undefined);
  await pool.query("UPDATE devices SET status='active',expires_at=NOW()-INTERVAL '1 minute' WHERE device_id=$1",[deviceId]);
  assert.equal((await post('/api/v1/subscribers/resolve',{...credentials,sessionTokens:[sessionToken]})).status,403);
  await pool.query("UPDATE devices SET status='active',expires_at=NULL WHERE device_id=$1",[deviceId]);
  assert.equal((await post('/api/v1/portal/playlists',{...credentials,...direct,name:'تعديل عربي محفوظ'})).status,200);
  const refreshed=await post('/api/v1/portal/playlists/list',credentials);assert.equal(refreshed.data.items.find(x=>x.id===direct.id).name,'تعديل عربي محفوظ');
  assert.equal((await fetch(base+'/portal')).status,200);assert.equal((await fetch(base+'/admin')).status,200);assert.equal((await fetch(base+'/releases')).status,200);
  console.log('PASS: reproduced baseline 404; rc07.40 mixed Xtream/BLOFY portal list and authenticated direct resolution succeed; existing device and playlist records preserved; cross-device, blocked and expired access denied.');
} finally {
  await stop();
  await pool.query('DELETE FROM devices WHERE device_id=$1',[deviceId]).catch(()=>{});await pool.end();
}

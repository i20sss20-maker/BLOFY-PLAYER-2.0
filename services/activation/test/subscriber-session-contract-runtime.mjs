import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import pg from 'pg';

// Only synthetic credentials against a local mock provider and isolated database.
const database=process.env.BLOFY_TEST_DATABASE_URL;
if(!database || !['127.0.0.1','localhost'].includes(new URL(database).hostname) || !new URL(database).pathname.includes('blofy_sync_test')) throw Error('Isolated local test database required');
const pool=new pg.Pool({connectionString:database});
const id='BLOFY-SESSION-'+crypto.randomBytes(4).toString('hex').toUpperCase();
const identity={deviceId:id,activationCode:'234567'};
const login={username:'test-subscriber',password:'test-password-only'};
let upstreamCalls=0;
const upstream=http.createServer((req,res)=>{
 upstreamCalls++;const u=new URL(req.url,'http://local');
 const valid=u.searchParams.get('username')===login.username && u.searchParams.get('password')===login.password;
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({user_info:{auth:valid?1:0,status:valid?'Active':'Disabled'}}));
});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const host='http://127.0.0.1:'+upstream.address().port;
const base='http://127.0.0.1:8095';
const env={...process.env,DATABASE_URL:database,PGSSLMODE:'disable',PORT:'8095',BLOFY_ADMIN_TOKEN:'test-only-admin-session-contract-token',BLOFY_ADMIN_USERNAME:'session-ci',BLOFY_ADMIN_PASSWORD:'test-only-password',BLOFY_PLAYLIST_ENCRYPTION_KEY:'b'.repeat(64),BLOFY_SUBSCRIBER_HOST:host};
const child=spawn(process.execPath,['src/bootstrap.mjs'],{env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function post(path,body){const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return{status:res.status,headers:res.headers,data:await res.json()};}
function directContract(data){assert.equal(data.delivery,'direct');assert.equal(data.baseUrl,host);assert.equal(data.username,login.username);assert.equal(data.password,login.password);assert.match(data.sessionToken,/^[A-Za-z0-9_-]{1,4096}$/);assert.ok(data.expiresAt>Date.now());}
try{
 let ready=false;for(let n=0;n<80;n++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(logs);await wait(100);}assert.ok(ready,'service startup');
 const releaseBefore=(await (await fetch(base+'/health')).json()).release.app;
 assert.equal((await post('/api/v1/activation/check',{...identity,appVersion:'2.0.0-rc07.40',platform:'android'})).status,200);
 const before=(await pool.query('SELECT activation_code,status,expires_at FROM devices WHERE device_id=$1',[id])).rows[0];
 let response=await post('/api/v1/subscribers/session',{...identity,...login,delivery:'direct'});assert.equal(response.status,200);directContract(response.data);assert.match(response.headers.get('cache-control'),/no-store/);
 const directToken=response.data.sessionToken;
 response=await post('/api/v1/subscribers/session',{...identity,...login});assert.equal(response.status,200);assert.equal(response.data.delivery,undefined);assert.equal(response.data.password,'blofy');assert.equal(response.data.baseUrl,base+'/api/v1/subscribers/xtream');assert.notEqual(response.data.username,login.username);assert.ok(!JSON.stringify(response.data).includes(host));assert.ok(!JSON.stringify(response.data).includes(login.password));
 const legacyToken=response.data.username;
 const ordinary={id:crypto.randomUUID(),name:'Xtream test',providerType:'xtream',baseUrl:'https://provider.example',username:'ordinary-user',password:'ordinary-password',active:true};
 const managed={id:crypto.randomUUID(),name:'مشتركي BLOFY اختبار',providerType:'xtream',baseUrl:'https://blofy.example/api/v1/subscribers/xtream',username:directToken,password:'blofy',active:false};
 for(const item of [ordinary,managed])assert.equal((await post('/api/v1/portal/playlists',{...identity,...item})).status,200);
 response=await post('/api/v1/portal/playlists/list',identity);assert.equal(response.status,200);assert.equal(response.data.items.length,2);assert.equal(response.data.items.find(x=>x.id===managed.id).username,directToken);
 response=await post('/api/v1/subscribers/resolve',{...identity,sessionTokens:[directToken,legacyToken]});assert.equal(response.status,200);response.data.items.forEach(directContract);
 const count=upstreamCalls;response=await post('/api/v1/subscribers/session',{...identity,...login,activationCode:'000000',delivery:'direct'});assert.equal(response.status,403);assert.equal(upstreamCalls,count);assert.equal(response.data.sessionToken,undefined);
 response=await post('/api/v1/subscribers/session',{...identity,...login,password:'incorrect',delivery:'direct'});assert.equal(response.status,401);assert.equal(response.data.sessionToken,undefined);
 assert.deepEqual((await pool.query('SELECT activation_code,status,expires_at FROM devices WHERE device_id=$1',[id])).rows[0],before);
 for(const change of ["status='blocked'","status='active',expires_at=NOW()-INTERVAL '1 minute'","status='active',expires_at=NULL,auth_locked_until=NOW()+INTERVAL '1 minute'"]){await pool.query('UPDATE devices SET '+change+' WHERE device_id=$1',[id]);const calls=upstreamCalls;response=await post('/api/v1/subscribers/session',{...identity,...login,delivery:'direct'});assert.equal(response.status,403);assert.equal(upstreamCalls,calls);assert.ok(!JSON.stringify(response.data).includes(login.password));}
 assert.deepEqual((await (await fetch(base+'/health')).json()).release.app,releaseBefore);
 assert.equal((await fetch(base+'/portal')).status,200);assert.equal((await fetch(base+'/releases')).status,200);
 console.log('PASS: Android direct session contract; legacy website keeps opaque credentials; mixed playlist save/list/resolve round-trip; wrong PIN, rejected account, blocked, expired and locked device denied; app release, activation expiry and portal routes preserved.');
}finally{child.kill('SIGTERM');for(let n=0;n<20&&child.exitCode===null;n++)await wait(100);if(child.exitCode===null)child.kill('SIGKILL');await pool.query('DELETE FROM devices WHERE device_id=$1',[id]).catch(()=>{});await pool.end();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));}

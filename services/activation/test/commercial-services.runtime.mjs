import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

test('commercial services: isolated PostgreSQL and actual HTTP contracts',async t=>{
  const raw=process.env.BLOFY_TEST_DATABASE_URL;
  assert.ok(raw,'BLOFY_TEST_DATABASE_URL required');
  const url=new URL(raw);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname==='/blofy_commercial_test','isolated local test database required');
  const schema='commercial_'+crypto.randomUUID().replaceAll('-','');
  const setup=new pg.Pool({connectionString:raw,ssl:false});
  await setup.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options','-c search_path='+schema);
  const pool=new pg.Pool({connectionString:url.toString(),ssl:false});
  let upstreamRequests=0;
  const upstream=http.createServer((req,res)=>{upstreamRequests++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({user_info:{auth:1,status:'Active'}}));});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const port=18379, origin='http://127.0.0.1:'+port;
  let output='';
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/bootstrap.mjs',import.meta.url))],{
    env:{...process.env,DATABASE_URL:url.toString(),PGSSLMODE:'disable',PORT:String(port),
      BLOFY_PLAYLIST_ENCRYPTION_KEY:'42'.repeat(32),BLOFY_ADMIN_TOKEN:'isolated-commercial-admin-123456789',
      BLOFY_SUBSCRIBER_HOST:'http://127.0.0.1:'+upstream.address().port,
      BLOFY_ALLOW_LEGACY_TRIAL:'false',BLOFY_AUTH_DEVICE_RATE_LIMIT:'1000',BLOFY_AUTH_IP_RATE_LIMIT:'1000'},
    stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>output=(output+b).slice(-12000));child.stderr.on('data',b=>output=(output+b).slice(-12000));
  t.after(async()=>{
    if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
    await new Promise(resolve=>upstream.close(resolve));await pool.end();
    await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();
  });
  let ready=false;
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw new Error('fixture exited: '+output);
    try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'fixture did not start: '+output);
  const pin='123456', ids=['BLOFY-AAAA-AAAA','BLOFY-BBBB-BBBB','BLOFY-CCCC-CCCC','BLOFY-DDDD-DDDD'];
  const scope=crypto.createHash('sha256').update('isolated-android-scope').digest('hex');
  const request=async(path,body,method='POST')=>{
    const response=await fetch(origin+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const auth=(id,extra={})=>({deviceId:id,activationCode:pin,...extra});
  await t.test('trial clock survives reinstall; missing identifiers never create free trials',async()=>{
    const first=await request('/api/v1/activation/check',auth(ids[0],{trialScope:scope}));
    const second=await request('/api/v1/activation/check',auth(ids[1],{trialScope:scope}));
    assert.equal(first.body.status,'trial');assert.equal(second.body.expiresAt,first.body.expiresAt);
    const absent=await request('/api/v1/activation/check',auth('BLOFY-NONE-NONE'));
    assert.equal(absent.body.status,'expired');
    await pool.query("UPDATE device_trial_claims SET expires_at=NOW()-INTERVAL '1 second'");
    const third=await request('/api/v1/activation/check',auth(ids[2],{trialScope:scope}));
    assert.equal(third.body.status,'expired');
    await request('/api/v1/activation/check',auth(ids[3],{trialScope:crypto.createHash('sha256').update('other-test-scope').digest('hex')}));
    const claim=(await pool.query('SELECT scope_hash FROM device_trial_claims LIMIT 1')).rows[0];
    assert.notEqual(claim.scope_hash,scope);
    const legacy='BLOFY-OLDX-OLDX', legacyScope=crypto.createHash('sha256').update('legacy-paid').digest('hex');
    await request('/api/v1/activation/check',auth(legacy));
    await pool.query("UPDATE devices SET status='active',trial_started_at=NOW()-INTERVAL '60 days',expires_at=NOW()+INTERVAL '1 year' WHERE device_id=$1",[legacy]);
    await request('/api/v1/activation/check',auth(legacy,{trialScope:legacyScope}));
    const reinstall=await request('/api/v1/activation/check',auth('BLOFY-NEWX-NEWX',{trialScope:legacyScope}));
    assert.equal(reinstall.body.status,'expired','An upgraded paid device must not grant its paid expiry as a new trial');
  });
  let token;
  await t.test('old proxy tokens stop after block, and stay revoked after unblock',async()=>{
    await pool.query("UPDATE devices SET status='active',expires_at=NOW()+INTERVAL '30 days' WHERE device_id=$1",[ids[0]]);
    const session=await request('/api/v1/subscribers/session',auth(ids[0],{username:'fixture',password:'fixture'}));
    assert.equal(session.status,200);token=session.body.username;
    const path='/api/v1/subscribers/xtream/player_api.php?username='+encodeURIComponent(token)+'&password=blofy';
    assert.equal((await fetch(origin+path)).status,200);
    await pool.query("UPDATE devices SET status='blocked' WHERE device_id=$1",[ids[0]]);
    const before=upstreamRequests;assert.equal((await fetch(origin+path)).status,401);assert.equal(upstreamRequests,before);
    await pool.query("UPDATE devices SET status='active' WHERE device_id=$1",[ids[0]]);
    assert.equal((await fetch(origin+path)).status,401);
    const direct=await request('/api/v1/subscribers/session',auth(ids[0],{username:'fixture',password:'fixture',delivery:'direct'}));
    assert.equal(direct.status,200);assert.equal(direct.body.delivery,'direct');assert.equal(direct.body.password,'fixture');
  });
  await t.test('profile writes isolate devices and serialize first-write conflicts',async()=>{
    const body=auth(ids[0],{profileId:'main',expectedRevision:0,payload:{watchlist:['one'],settings:{subtitles:true,password:'discard'}}});
    const writes=await Promise.all([request('/api/v1/cloud/profile',body,'PUT'),request('/api/v1/cloud/profile',body,'PUT')]);
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
    assert.equal(writes.find(r=>r.status===200).body.payload.settings.password,undefined);
    const response=await fetch(origin+'/api/v1/cloud/profile?profileId=main',{headers:{'X-BLOFY-Device-ID':ids[1],'X-BLOFY-Activation-Code':pin}});
    assert.equal(response.status,200);assert.equal((await response.json()).exists,false);
    assert.equal((await fetch(origin+'/api/v1/cloud/profile?profileId=main&deviceId='+ids[0]+'&activationCode='+pin)).status,403);
  });
  let recoveredId;
  await t.test('one recovery code transfers one entitlement; lost-response retries are safe',async()=>{
    const issued=await request('/api/v1/license/recovery/create',auth(ids[0]));
    assert.equal(issued.status,201);assert.match(issued.body.recoveryCode,/^[A-Za-z0-9_-]{32}$/);
    const expiry=(await pool.query('SELECT expires_at FROM devices WHERE device_id=$1',[ids[0]])).rows[0].expires_at.getTime();
    const results=await Promise.all([ids[1],ids[3]].map(id=>request('/api/v1/license/recovery/restore',auth(id,{recoveryCode:issued.body.recoveryCode}))));
    assert.equal(results.filter(r=>r.status===200).length,1);
    recoveredId=results[0].status===200?ids[1]:ids[3];
    const replay=await request('/api/v1/license/recovery/restore',auth(recoveredId,{recoveryCode:issued.body.recoveryCode}));
    assert.equal(replay.body.replayed,true);assert.equal(replay.body.expiresAt,expiry);
    assert.equal((await pool.query('SELECT status FROM devices WHERE device_id=$1',[ids[0]])).rows[0].status,'blocked');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM device_playlists WHERE device_id=$1',[recoveredId])).rows[0].n,0);
  });
  await t.test('plans/status and public policy work; Play management has no renewal navigation',async()=>{
    assert.equal((await fetch(origin+'/api/v1/subscriptions/plans')).status,200);
    assert.equal((await request('/api/v1/subscriptions/status',auth(recoveredId))).body.active,true);
    const page=await fetch(origin+'/privacy');assert.equal(page.status,200);assert.match(await page.text(),/privacy-form/);
    const connect=await (await fetch(origin+'/connect')).text();assert.doesNotMatch(connect,/blofyRenewBtn|href="\/"/);
    const support=await request('/api/v1/privacy/support',auth(recoveredId,{message:'استفسار تجريبي معزول عن الخصوصية'}));
    assert.equal(support.status,201);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM support_tickets WHERE device_id=$1',[recoveredId])).rows[0].n,1);
  });
  await t.test('deletion requires explicit confirmation and revokes only the chosen device',async()=>{
    const rejected=await request('/api/v1/privacy/delete',auth(recoveredId));assert.equal(rejected.status,400);
    const deleted=await request('/api/v1/privacy/delete',auth(recoveredId,{confirmation:'DELETE'}));assert.equal(deleted.status,200);
    const row=(await pool.query('SELECT * FROM devices WHERE device_id=$1',[recoveredId])).rows[0];
    assert.equal(row.status,'blocked');assert.ok(row.data_deleted_at);assert.match(row.activation_code,/^deleted:/);
    assert.equal((await request('/api/v1/subscriptions/status',auth(recoveredId))).status,403);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM support_tickets WHERE device_id=$1',[recoveredId])).rows[0].n,0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM profile_cloud_snapshots WHERE device_id=$1',[ids[0]])).rows[0].n,1);
  });
});

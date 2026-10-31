import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

// This suite MUST NEVER run against production. It inserts synthetic device records.
function onlyLocal(value,protocols,name) {
  assert.ok(value, name+' must be configured');
  const url = new URL(value);
  assert.ok(protocols.includes(url.protocol),name+' protocol');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),name+' must use loopback');
  return url;
}
const baseUrl=onlyLocal(process.env.BLOFY_E2E_BASE_URL,['http:'],'BLOFY_E2E_BASE_URL');
const dbUrl=onlyLocal(process.env.DATABASE_URL,['postgres:','postgresql:'],'DATABASE_URL');
assert.equal(process.env.PGSSLMODE,'disable');
assert.ok((process.env.BLOFY_ADMIN_TOKEN||'').length>=24);
const pool=new pg.Pool({connectionString:dbUrl.href,ssl:false});
const suffix=crypto.randomBytes(4).toString('hex').toUpperCase();
const id=i=>`BLOFY-${suffix}-${String(i).padStart(4,'0')}`;
const old={deviceId:id(1),activationCode:'245679'};
const fresh={deviceId:id(2),activationCode:'683421'};
const paid={deviceId:id(3),activationCode:'424243'};
const newPaid={deviceId:id(4),activationCode:'747475'};
const started=[];
async function api(path,body,headers={}) {
  const r=await fetch(new URL(path,baseUrl),{
    method:'POST',headers:{'content-type':'application/json',...headers},
    body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)
  });
  return {status:r.status,data:await r.json()};
}
const check=(d,version='factory-reset-e2e')=>api('/api/v1/activation/check',{...d,appVersion:version,platform:'android'});
const row=async deviceId=>(await pool.query('SELECT * FROM devices WHERE device_id=$1',[deviceId])).rows[0];
const expect=(response,status)=>assert.equal(response.status,status,JSON.stringify(response.data));
try {
  expect(await check(old),200); started.push(old.deviceId);
  const original=await row(old.deviceId);assert.equal(original.status,'trial');
  const playlistId=crypto.randomUUID();
  expect(await api('/api/v1/portal/playlists',{
    ...old,id:playlistId,name:'Factory Reset Test',providerType:'xtream',
    baseUrl:'https://provider.example.test',username:'fixture',password:'fixture-pass',active:true
  }),200);
  const issued=await api('/api/v1/license/recovery/create',old);
  expect(issued,200);assert.match(issued.data.recoveryCode,/^[A-Za-z0-9_-]{32}$/);
  expect(await check(fresh),200);started.push(fresh.deviceId);
  const disposable=await row(fresh.deviceId);assert.equal(disposable.status,'trial');
  const restored=await api('/api/v1/license/recovery/restore',
    {...fresh,recoveryCode:issued.data.recoveryCode});
  expect(restored,200);assert.equal(restored.data.canonicalDeviceId,old.deviceId);
  assert.equal(await row(fresh.deviceId),undefined,'disposable fresh trial row must be removed');
  const after=await row(old.deviceId);
  assert.equal(after.status,'trial');
  assert.equal(after.expires_at.getTime(),original.expires_at.getTime());
  assert.equal(after.trial_started_at.getTime(),original.trial_started_at.getTime());
  const alias=await check(fresh,'factory-reset-restored');
  expect(alias,200);assert.equal(alias.data.canonicalDeviceId,old.deviceId);
  assert.equal(alias.data.recovered,true);
  const list=await api('/api/v1/portal/playlists/list',
    {deviceId:old.deviceId,activationCode:fresh.activationCode});
  expect(list,200);assert.ok(list.data.items.some(x=>x.id===playlistId));
  expect(await api('/api/v1/license/recovery/restore',
    {...fresh,recoveryCode:issued.data.recoveryCode}),403);
  const oldAccess=await check(old,'old-install-no-longer-authorized');
  expect(oldAccess,403);

  // Admin can recover a paid user who formatted before saving a recovery key.
  expect(await check(paid),200);started.push(paid.deviceId);
  expect(await check(newPaid),200);started.push(newPaid.deviceId);
  const adminHeaders={authorization:'Bearer '+process.env.BLOFY_ADMIN_TOKEN};
  expect(await fetch(new URL('/api/v1/admin/devices/'+paid.deviceId,baseUrl),{
    method:'PATCH',headers:{'content-type':'application/json',...adminHeaders},
    body:JSON.stringify({status:'active',days:90})
  }).then(async r=>({status:r.status,data:await r.json()})),200);
  const paidBefore=await row(paid.deviceId);
  expect(await api('/api/v1/admin/device/recovery/restore',{
    originalDeviceId:paid.deviceId,targetDeviceId:newPaid.deviceId,
    targetActivationCode:newPaid.activationCode,confirmedOwnership:false,
    reason:'Customer verified order and customer identity'
  },adminHeaders),400);
  const manual=await api('/api/v1/admin/device/recovery/restore',{
    originalDeviceId:paid.deviceId,targetDeviceId:newPaid.deviceId,
    targetActivationCode:newPaid.activationCode,confirmedOwnership:true,
    reason:'Customer verified order and customer identity'
  },adminHeaders);
  expect(manual,200);assert.equal(manual.data.canonicalDeviceId,paid.deviceId);
  const paidAfter=await row(paid.deviceId);
  assert.equal(paidAfter.status,'active');
  assert.equal(paidAfter.expires_at.getTime(),paidBefore.expires_at.getTime());
  const paidAlias=await check(newPaid);
  expect(paidAlias,200);assert.equal(paidAlias.data.canonicalDeviceId,paid.deviceId);
  console.log('Factory reset recovered canonical ID, original trial, expiry, playlist and paid entitlement');
} finally {
  for(const deviceId of started){
    await pool.query('DELETE FROM devices WHERE device_id=$1',[deviceId]);
  }
  await pool.end();
}

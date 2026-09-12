import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {addCalendarMonths} from '../src/admin-renewals.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const base=process.env.BLOFY_E2E_BASE_URL||'http://127.0.0.1:8080';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Experience E2E is restricted to an isolated local service');
const deviceId='BLOFY-'+crypto.randomBytes(2).toString('hex').toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
const activationCode='654321';
async function request(path,body,{admin=false,method=body?'POST':'GET',status=200}={}){
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(admin?{authorization:'Bearer '+process.env.BLOFY_ADMIN_TOKEN}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    // The full CI suite shares an IP. Respect the real limiter instead of weakening it for tests.
    if(response.status===429&&status!==429&&attempt<2){
      const seconds=Number(response.headers.get('retry-after')||data.retryAfterSeconds||60);
      await delay((Math.min(60,Math.max(1,seconds))+1)*1000);continue;
    }
    assert.equal(response.status,status,JSON.stringify(data));return data;
  }
}
const identity={deviceId,activationCode};
await request('/api/v1/activation/check',{...identity,appVersion:'experience-e2e',platform:'android'});
const created=await request('/api/v1/portal/experience/support',{...identity,description:'The series import is slow after a network change.'});
assert.ok(created.ticketId);
let account=await request('/api/v1/portal/experience/customer',identity);
assert.equal(account.tickets[0].id,created.ticketId);assert.equal(account.customer,undefined);assert.equal(account.audit,undefined);
await request('/api/v1/portal/experience/customer',{...identity,activationCode:'000000'},{status:403});
let record=await request('/api/v1/admin/experience/customer?deviceId='+deviceId,null,{admin:true});
assert.ok(record.audit.some(x=>x.action==='support_created'));
await request('/api/v1/admin/experience/support',{deviceId,ticketId:created.ticketId,status:'resolved'},{admin:true});
await request('/api/v1/admin/devices/'+deviceId,{status:'expired'},{method:'PATCH',admin:true});
account=await request('/api/v1/portal/experience/customer',identity);
assert.equal(account.status,'expired');assert.equal(account.tickets[0].status,'resolved');
await request('/api/v1/portal/experience/check',{...identity,playlistId:crypto.randomUUID()},{status:403});
record=await request('/api/v1/admin/experience/customer?deviceId='+deviceId,null,{admin:true});
assert.ok(record.audit.some(x=>x.action==='activation_changed'));assert.ok(record.audit.some(x=>x.action==='support_updated'));
const releasePath='/api/v1/admin/experience/releases';
const beforeReleases=await request(releasePath,null,{admin:true});
await request(releasePath,{revision:beforeReleases.revision,channel:'testing',versionCode:2000046,versionName:'2.0.0-rc07.35',downloadUrl:'https://example.test/fixture.apk',releaseNotes:'Isolated E2E release'},{admin:true});
const releases=await request('/api/v1/releases');assert.ok(releases.items.some(x=>x.versionCode===2000046));
assert.equal(releases.primaryVersionCode,beforeReleases.primaryVersionCode,'Saving must not silently promote a version');
let edited=await request(releasePath+'/2000046',{...releases.items.find(x=>x.versionCode===2000046),revision:releases.revision,releaseNotes:'Edited note'},{admin:true,method:'PATCH'});
assert.equal(edited.items.find(x=>x.versionCode===2000046).releaseNotes,'Edited note');
let promoted=await request(releasePath+'/2000046/primary',{revision:edited.revision},{admin:true});
assert.equal((await request('/health')).release.app.versionCode,2000046);
await request(releasePath+'/2000046',{revision:promoted.revision},{admin:true,method:'DELETE',status:409});
await request(releasePath+'/2000046/primary',{revision:edited.revision},{admin:true,status:409});
const redirect=await fetch(base+'/download/latest.apk',{redirect:'manual'});
assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://example.test/fixture.apk');
const restored=await request(releasePath+'/'+beforeReleases.primaryVersionCode+'/primary',{revision:promoted.revision},{admin:true});
await request(releasePath+'/2000046',{revision:restored.revision},{admin:true,method:'DELETE'});
assert.ok(!(await request('/api/v1/releases')).items.some(x=>x.versionCode===2000046));
console.log('PASS: account ownership, expired-device read access, support persistence/resolution, audit and release publishing');

const options=await request('/api/v1/admin/experience/renewal-options',null,{admin:true});
assert.deepEqual(options.items.map(x=>x.months),[1,3,6,12,null]);
for(const option of options.items){
  const id='BLOFY-'+crypto.randomBytes(2).toString('hex').toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
  await request('/api/v1/activation/check',{deviceId:id,activationCode,appVersion:'manual-renewal-e2e',platform:'android'});
  const before=await request('/api/v1/admin/experience/customer?deviceId='+id,null,{admin:true});
  const preview=await request('/api/v1/admin/experience/renewal-preview',{deviceId:id,duration:option.key},{admin:true});
  const expected=option.months===null?null:addCalendarMonths(before.expiresAt,option.months);
  assert.equal(preview.expiresAt,expected);
  const payload={deviceId:id,duration:option.key,requestId:crypto.randomUUID(),expectedExpiresAt:before.expiresAt};
  const grant=await request('/api/v1/admin/experience/renew',payload,{admin:true});assert.equal(grant.expiresAt,expected);
  const replay=await request('/api/v1/admin/experience/renew',payload,{admin:true});assert.equal(replay.replayed,true);
  const after=await request('/api/v1/admin/experience/customer?deviceId='+id,null,{admin:true});
  assert.equal(after.status,'active');assert.equal(after.expiresAt,expected);assert.equal(after.audit.filter(x=>x.action==='subscription_granted').length,1);
  await request('/api/v1/admin/experience/renew',{...payload,requestId:crypto.randomUUID()},{admin:true,status:409});
  if(option.key==='lifetime')await request('/api/v1/admin/experience/renewal-preview',{deviceId:id,duration:'year'},{admin:true,status:409});
}
const publicPlans=await request('/api/v1/subscriptions/plans');assert.ok(publicPlans.items.every(p=>!p.key.startsWith('admin-manual-')));
await request('/api/v1/admin/devices/'+deviceId,{status:'blocked'},{method:'PATCH',admin:true});
await request('/api/v1/admin/experience/renewal-preview',{deviceId,duration:'lifetime'},{admin:true,status:409});
console.log('PASS: all five manual renewals persist, remaining time retained, lifetime has no expiry, duplicate/stale requests rejected safely, manual options hidden from checkout');

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base=process.env.BLOFY_E2E_BASE_URL||'http://127.0.0.1:8080';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Experience E2E is restricted to an isolated local service');
const deviceId='BLOFY-'+crypto.randomBytes(2).toString('hex').toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
const activationCode='654321';
async function request(path,body,{admin=false,method=body?'POST':'GET',status=200}={}){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(admin?{authorization:'Bearer '+process.env.BLOFY_ADMIN_TOKEN}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
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
await request('/api/v1/admin/experience/releases',{channel:'testing',versionCode:2000046,versionName:'2.0.0-rc07.35',downloadUrl:'https://example.test/fixture.apk',releaseNotes:'Isolated E2E release'},{admin:true});
const releases=await request('/api/v1/releases');assert.equal(releases.items.find(x=>x.channel==='testing').versionCode,2000046);
console.log('PASS: account ownership, expired-device read access, support persistence/resolution, audit and release publishing');

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceAdmin, deviceView, deviceFilters, validateDeviceProfile, DeviceAdminError } from '../src/device-admin.mjs';
const now=Date.UTC(2026,8,13,1);
const row={device_id:'BLOFY-TEST-ABCD',status:'trial',created_at:new Date(now-3600000),last_seen_at:new Date(now-60000),expires_at:new Date(now+86400000),playlist_count:2};
test('new badge measures first registration, never claims install time or live presence',()=>{
 const item=deviceView(row,now);assert.equal(item.isNew,true);assert.equal(item.recentlySeen,true);assert.equal(item.remainingDays,1);assert.equal(item.playlistCount,2);
 assert.equal(item.firstSeenAt,now-3600000);assert.ok(!('installedAt' in item));assert.ok(!('online' in item));
});
test('exact 24h boundary, future/unknown first-seen and stale contact are not new/recent',()=>{
 for(const created_at of [new Date(now-86400000),new Date(now+1),null,'invalid'])assert.equal(deviceView({...row,created_at},now).isNew,false);
 for(const last_seen_at of [new Date(now-600000),new Date(now+1),null])assert.equal(deviceView({...row,last_seen_at},now).recentlySeen,false);
});
test('expiry is normalized without mutating row; block and lifetime stay distinct',()=>{
 const stale={...row,status:'active',expires_at:new Date(now-100)};assert.equal(deviceView(stale,now).status,'expired');assert.equal(stale.status,'active');
 assert.equal(deviceView({...stale,status:'blocked'},now).status,'blocked');assert.equal(deviceView({...row,status:'active',expires_at:null},now).remainingDays,null);
});
test('device view contains no pairing proof, playlist secrets, or invented hardware details',()=>{
 const x=deviceView({...row,activation_code:'SECRET',username_enc:'SECRET',password_enc:'SECRET',base_url_enc:'SECRET'},now);
 assert.ok(!JSON.stringify(x).includes('SECRET'));for(const key of ['model','ip','ram','activationCode'])assert.ok(!(key in x));
});
test('filters are allowlisted, search bounded and pagination validated',()=>{
 assert.equal(deviceFilters(new URLSearchParams()).limit,50);assert.equal(deviceFilters(new URLSearchParams('filter=expiring7d')).filter,'expiring7d');
 for(const q of ['filter=sql','sort=drop','page=0','page=-1','page=1.5','page=NaN','page=10001'])assert.throws(()=>deviceFilters(new URLSearchParams(q)),DeviceAdminError);
 assert.equal(deviceFilters(new URLSearchParams({q:'x'.repeat(300),version:'v'.repeat(90)})).q.length,128);
});
test('profile validation preserves Arabic and enforces revision, size and control-character limits',()=>{
 const p={name:' عميل اختبار ',phone:'0501234567',email:'test@example.invalid',notes:'ملاحظة\nداخلية',expectedRevision:0};
 assert.equal(validateDeviceProfile(p).name,'عميل اختبار');assert.equal(validateDeviceProfile(p).notes,'ملاحظة\nداخلية');
 for(const bad of [null,[],{}, {...p,expectedRevision:-1},{...p,expectedRevision:'0'},{...p,notes:'a'.repeat(2001)},{...p,email:'bad'},{...p,name:'x\0'}])assert.throws(()=>validateDeviceProfile(bad),DeviceAdminError);
});
test('authorization precedes body parsing and all database/schema work',async()=>{
 let calls=0;const fail=()=>{calls++;throw Error('must not touch data');};
 const handler=createDeviceAdmin({pool:{query:fail,connect:fail},ensureAdmin:fail,readJson:fail,requireAdmin:()=>false,json:fail});
 for(const method of ['GET','PATCH','POST','DELETE'])assert.equal(await handler({method},{},new URL('http://test/api/v1/admin/device-insights/BLOFY-TEST-ABCD/status')),true);
 assert.equal(calls,0);
});
test('unrelated portal, playback, releases and activation routes are untouched',async()=>{
 let called=false;const handler=createDeviceAdmin({pool:{},json:()=>{},requireAdmin:()=>{called=true;return false;}});
 for(const path of ['/health','/api/v1/activation/check','/api/v1/portal/playlists/list','/api/v1/subscribers/resolve','/api/v1/admin/experience/releases'])assert.equal(await handler({method:'POST'},{},new URL('http://test'+path)),false);
 assert.equal(called,false);
});
test('invalid path/filter fails before database access',async()=>{
 const out=[];const handler=createDeviceAdmin({pool:{connect:()=>{throw Error('DB called');}},json:(_res,code,body)=>out.push([code,body]),requireAdmin:()=>true});
 for(const path of ['/api/v1/admin/device-insights?filter=oops','/api/v1/admin/device-insights/%ZZ','/api/v1/admin/device-insights/not-device'])await handler({method:'GET'},{},new URL('http://test'+path));
 assert.deepEqual(out.map(x=>x[0]),[400,400,400]);
});

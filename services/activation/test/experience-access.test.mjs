import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperienceHandlers} from '../src/experience-handlers.mjs';

function fixture(overrides={}) {
  const calls=[]; let probes=0;
  const pool={async query(sql,params){calls.push({sql,params});return {rows:[]};}};
  const handlers=createExperienceHandlers({pool,json:(res,status,body)=>Object.assign(res,{status,body}),readJson:async req=>req.body||{},
    requireAdmin(req,res){if(req.admin)return true;Object.assign(res,{status:401,body:{error:'unauthorized'}});return false;},
    authorizedDevice:async(id,pin)=>id==='BLOFY-DEMO-0001'&&pin==='123456'?{device_id:id}:null,
    probe:async()=>{probes++;return {state:'active'};},...overrides});
  return {calls,get probes(){return probes;},async request(path,{method='GET',body,admin=false}={}){
    const res={headers:{},writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
    res.handled=await handlers.handle({method,body,admin},res,new URL(path,'https://fixture.example'));
    return res;
  }};
}

test('admin experience routes require admin authentication before reading or writing',async()=>{
  const f=fixture();
  for(const path of ['overview','tickets','customer?deviceId=BLOFY-DEMO-0001','releases']) {
    const res=await f.request('/api/v1/admin/experience/'+path,{method:path==='releases'?'POST':'GET'});
    assert.equal(res.status,401);
  }
  assert.equal(f.calls.length,0);assert.equal(f.probes,0);
});

test('device account requests reject URL credentials and incorrect PINs before reads',async()=>{
  const f=fixture();
  assert.equal((await f.request('/api/v1/portal/experience/customer?deviceId=BLOFY-DEMO-0001&activationCode=123456')).status,405);
  assert.equal((await f.request('/api/v1/portal/experience/customer',{method:'POST',body:{deviceId:'BLOFY-DEMO-0001',activationCode:'000000'}})).status,403);
  assert.equal(f.calls.length,0);
});

test('a device cannot probe a playlist owned by another device',async()=>{
  const f=fixture(); const playlistId='00000000-0000-4000-8000-000000000002';
  const res=await f.request('/api/v1/portal/experience/check',{method:'POST',body:{deviceId:'BLOFY-DEMO-0001',activationCode:'123456',playlistId}});
  assert.equal(res.status,404);assert.equal(f.probes,0);
  assert.deepEqual(f.calls[0].params,['BLOFY-DEMO-0001',playlistId]);
});

test('device summaries expose neither transport credentials nor admin customer data',async()=>{
  const f=fixture({pool:{async query(sql){return {rows:sql.includes('FROM devices d')?[{device_id:'BLOFY-DEMO-0001',status:'active',customer_name:'Private',customer_phone:'555',activation_code:'secret'}]:sql.includes('FROM device_playlists')?[{id:'playlist',name:'My list',provider_type:'xtream',active:true,base_url_enc:'hidden-host',username_enc:'hidden-user',password_enc:'hidden-pass'}]:[]};}}});
  const res=await f.request('/api/v1/portal/experience/customer',{method:'POST',body:{deviceId:'BLOFY-DEMO-0001',activationCode:'123456'}});
  assert.equal(res.status,200);assert.equal(res.body.playlists[0].name,'My list');
  for(const value of ['Private','555','secret','hidden-host','hidden-user','hidden-pass','customer','audit']) assert.ok(!JSON.stringify(res.body).includes(value));
});

test('download publishing rejects insecure or incomplete releases before transactions',async()=>{
  const f=fixture();
  for(const downloadUrl of ['http://example.test/app.apk','javascript:alert(1)','https://user:password@example.test/app.apk']) {
    const res=await f.request('/api/v1/admin/experience/releases',{admin:true,method:'POST',body:{channel:'stable',versionCode:2,versionName:'2.0',downloadUrl}});
    assert.equal(res.status,400);
  }
  assert.equal(f.calls.length,0);
});

test('new public pages retain legacy QR routing and enforce a self-only script policy',async()=>{
  const f=fixture();
  assert.equal((await f.request('/?deviceId=BLOFY-DEMO-0001&activationCode=123456')).handled,false);
  const home=await f.request('/');
  assert.equal(home.status,200);assert.match(String(home.body),/data-page="home"/);
  assert.match(home.headers['content-security-policy'],/script-src 'self'/);
  assert.equal(f.calls.length,0);
});

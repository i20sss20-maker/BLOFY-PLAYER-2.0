import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {readAccount,summarizeAccount,probeAccount} from '../src/account-health.mjs';

const key=Buffer.alloc(32,4),env={BLOFY_PLAYLIST_ENCRYPTION_KEY:key.toString('hex'),BLOFY_SUBSCRIBER_HOST:'https://source.example.test'};
function seal(text){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');}
function row(base='https://source.example.test',user='fixture-user'){return{device_id:'BLOFY-TEST-0001',provider_type:'xtream',base_url_enc:seal(base),username_enc:seal(user),password_enc:seal('fixture-password')};}
test('auth=1 cannot override an expired streaming subscription',()=>{assert.equal(summarizeAccount({user_info:{auth:1,status:'Expired',exp_date:100}},200000).state,'expired');});
test('connection count is separate from validity and unknown replies fail closed',()=>{
  assert.equal(summarizeAccount({user_info:{auth:1,status:'Active',active_cons:1,max_connections:1}}).state,'connection_limit');
  assert.equal(summarizeAccount({user_info:{auth:1}}).state,'unknown');
  assert.equal(summarizeAccount({user_info:{auth:0,status:'Active'}}).state,'invalid_account');
});
test('managed account envelopes must belong to the selected device and be unexpired',()=>{
  const token=seal(JSON.stringify({d:'BLOFY-OTHER-0001',exp:Date.now()+100000,u:'u',p:'p'}));
  assert.equal(readAccount(row('https://portal.example.test/api/v1/subscribers/xtream',token),env).error,'session_expired');
  const expired=seal(JSON.stringify({d:'BLOFY-TEST-0001',exp:1,u:'u',p:'p'}));
  assert.equal(readAccount(row('https://portal.example.test/api/v1/subscribers/xtream',expired),env).error,'session_expired');
});
test('private DNS results never receive saved credentials',async()=>{
  let sent=false;const result=await probeAccount(row(),{env,resolve:async()=>[{address:'127.0.0.1',family:4}],request:()=>{sent=true;}});
  assert.equal(result.state,'unreachable');assert.equal(sent,false);
});
test('public address is pinned, only account metadata is requested, and secrets do not escape',async()=>{
  let count=0;let requestPath='';
  const result=await probeAccount(row(),{env,resolve:async()=>{count++;return[{address:'8.8.8.8',family:4}];},request:(url,options,callback)=>{
    requestPath=url.pathname;options.lookup(url.hostname,{},(_err,address)=>assert.equal(address,'8.8.8.8'));
    const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{const response=new EventEmitter();response.statusCode=200;response.destroy=()=>{};callback(response);
      response.emit('data',Buffer.from(JSON.stringify({user_info:{auth:1,status:'Active',username:'fixture-user',password:'fixture-password'},server_info:{url:'secret-host'}})));response.emit('end');};return req;
  }});
  assert.equal(result.state,'active');assert.equal(count,1);assert.equal(requestPath,'/player_api.php');assert.doesNotMatch(JSON.stringify(result),/fixture|secret-host|https?:/);
});
test('HTTP redirects are closed without a second credential request',async()=>{
  let closed=false;const result=await probeAccount(row(),{env,resolve:async()=>[{address:'8.8.8.8',family:4}],request:(_url,_opts,callback)=>{const req=new EventEmitter();req.end=()=>callback({statusCode:302,destroy(){closed=true;}});req.destroy=()=>{};return req;}});
  assert.equal(result.state,'unreachable');assert.equal(closed,true);
});

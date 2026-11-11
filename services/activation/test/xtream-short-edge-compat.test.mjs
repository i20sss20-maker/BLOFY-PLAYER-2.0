import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeXtreamPublicOrigin} from '../src/xtream-public-origin.mjs';
import {probeXtreamLogin} from '../src/xtream-compatibility-probe.mjs';
test('fixed public origin requires a bare HTTPS host',()=>{
  assert.equal(normalizeXtreamPublicOrigin('https://bfy.up.railway.app'),'https://bfy.up.railway.app');
  for(const value of ['http://bfy.up.railway.app','https://bfy.up.railway.app/path',
    'https://u:p@bfy.up.railway.app','https://bfy.up.railway.app?redirect=x',
    'https://bfy.up.railway.app:8443','https://localhost','']){
    assert.equal(normalizeXtreamPublicOrigin(value),null,value);
  }
});
const stub=(result)=>async(url,opts)=>{
  assert.equal(url.origin,'https://bfy.up.railway.app');
  assert.equal(url.pathname,'/player_api.php');
  assert.equal(url.searchParams.get('username'),'testUser');
  assert.equal(url.searchParams.get('password'),'testPass');
  assert.equal(opts.redirect,'manual');
  return {status:200,headers:new Headers({'content-type':'application/json'}),
    text:async()=>JSON.stringify(result)};
};
test('valid Xtream login and matching advertised server succeeds',async()=>{
  const result=await probeXtreamLogin({baseUrl:'https://bfy.up.railway.app',username:'testUser',
    password:'testPass',fetchImpl:stub({user_info:{auth:1},
      server_info:{url:'bfy.up.railway.app',server_protocol:'https'}})});
  assert.equal(result.ok,true);assert.equal(result.code,'xtream_login_compatible');
});
test('HTTP 200 with auth:0 is never counted as a successful login',async()=>{
  const result=await probeXtreamLogin({baseUrl:'https://bfy.up.railway.app',username:'testUser',
    password:'testPass',fetchImpl:stub({user_info:{auth:0},server_info:{url:'bfy.up.railway.app',server_protocol:'https'}})});
  assert.equal(result.ok,false);assert.equal(result.code,'account_auth_denied');
});
test('advertised server mismatch is detected for third-party players',async()=>{
  const result=await probeXtreamLogin({baseUrl:'https://bfy.up.railway.app',username:'testUser',
    password:'testPass',fetchImpl:stub({user_info:{auth:1},server_info:{url:'blofyplayer.com',server_protocol:'https'}})});
  assert.equal(result.ok,false);assert.equal(result.code,'server_info_origin_mismatch');
});

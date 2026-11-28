import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {normalizeDirectEntry,directAccountProbeUrl,classifyDirectAccount,probeDirectAccount} from '../direct-provider-entry.mjs';
test('first-party Xtream entry and generated M3U map to the same credentials',()=>{
 const expected={origin:'https://x.blofyplayer.com',username:'demo&user',password:'p+word'};
 assert.deepEqual(normalizeDirectEntry({mode:'xtream',host:expected.origin,username:expected.username,password:expected.password}),expected);
 assert.deepEqual(normalizeDirectEntry({mode:'m3u',url:expected.origin+'/get.php?username=demo%26user&password=p%2Bword&type=m3u_plus&output=ts'}),expected);
 const u=directAccountProbeUrl(expected);assert.equal(u.pathname,'/player_api.php');assert.equal(u.origin,expected.origin);assert.equal(u.searchParams.get('username'),expected.username);assert.equal(u.searchParams.get('password'),expected.password);
});
test('reject unsafe destinations, credentials in authority, duplicates and unsupported lists',()=>{
 for(const host of ['http://x.blofyplayer.com','https://x.blofyplayer.com.evil.test','https://127.0.0.1','https://169.254.169.254','https://x.blofyplayer.com@evil.test','https://x.blofyplayer.com:8443','https://x.blofyplayer.com/admin','https://x.blofyplayer.com/?x=1','https://x.blofyplayer.com/#x','https://user:pass@x.blofyplayer.com']){
  assert.throws(()=>normalizeDirectEntry({mode:'xtream',host,username:'u',password:'p'}));
 }
 for(const path of ['/playlist.m3u','/get.php?username=u&username=v&password=p','/get.php?username=u&password=p&extra=1','/get.php?username=u&password=','/get.php?username=u&password=p%0A'])assert.throws(()=>normalizeDirectEntry({mode:'m3u',url:'https://x.blofyplayer.com'+path}));
 assert.throws(()=>directAccountProbeUrl({origin:'https://evil.test',username:'u',password:'p'}));
});
test('only active accounts return minimal metadata, without provider secrets',()=>{
 assert.deepEqual(classifyDirectAccount({user_info:{auth:1,status:'Active',exp_date:'2000',username:'u',password:'p'},server_info:{url:'private'}},1000),{ok:true,expiresAt:2000000});
 assert.equal(classifyDirectAccount({user_info:{auth:0,status:'Active',exp_date:null}}).ok,false);
 assert.equal(classifyDirectAccount({user_info:{auth:1,status:'Disabled',exp_date:null}}).ok,false);
 assert.equal(classifyDirectAccount({user_info:{auth:1,status:'Active',exp_date:'1'}},1001).ok,false);
 assert.equal(classifyDirectAccount({user_info:{auth:1,status:'Active',exp_date:null}}).expiresAt,null);
});

test('probe uses only the fixed account endpoint and never returns credentials or follows redirects',async()=>{
 const input={mode:'xtream',host:'https://x.blofyplayer.com',username:'synthetic',password:'fixture'};
 let count=0;
 const active=await probeDirectAccount(input,{now:1000,fetchImpl:async(url,options)=>{
  count++;assert.equal(url.origin,input.host);assert.equal(url.pathname,'/player_api.php');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert.equal(options.headers.Accept,'application/json');
  return new Response(JSON.stringify({user_info:{auth:1,status:'Active',exp_date:'2000',password:'fixture'}}))
 }});
 assert.deepEqual(active,{ok:true,expiresAt:2000000});assert.equal(count,1);
 const redirect=await probeDirectAccount(input,{fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1'}})});
 assert.equal(redirect.ok,false);
 const oversized=await probeDirectAccount(input,{fetchImpl:async()=>new Response('x'.repeat(65537))});assert.equal(oversized.error,'provider_response_too_large');
 const denied=await probeDirectAccount({...input,host:'https://evil.test'},{fetchImpl:async()=>{throw Error('must never call')}});assert.equal(denied.error,'provider_not_approved');
});

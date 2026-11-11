import test from 'node:test';
import assert from 'node:assert/strict';
import {probeXtreamAccountCompatibility} from '../src/xtream-compatibility-probe.mjs';

const account={user_info:{auth:1,status:'Active'},
  server_info:{url:'bfy.up.railway.app',server_protocol:'https'}};
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{
  status,headers:{'content-type':'application/json'}
});
function fakeClient({failedAction=null,noCatalog=false,postDenied=false}={}){
  const called=[];
  const fetchImpl=async(url,options)=>{
    called.push({path:url.pathname,method:options.method,
      action:url.searchParams.get('action')});
    const method=options.method;
    const action=url.searchParams.get('action');
    if(method==='POST'){
      assert.equal(url.searchParams.get('password'),null);
      assert.equal(String(options.body.get('username')),'testUser');
      assert.equal(String(options.body.get('password')),'testPass');
      return json(postDenied?{user_info:{auth:0}}:account);
    }
    assert.equal(url.searchParams.get('username'),'testUser');
    assert.equal(url.searchParams.get('password'),'testPass');
    if(action===failedAction)return json({error:'error'},503);
    if(action?.includes('categories'))return json(noCatalog?[]:[{category_id:'1'}]);
    return json(account);
  };
  return {called,fetchImpl};
}
test('realistic GET, POST, panel and 3 category response checks pass',async()=>{
  const client=fakeClient();
  const r=await probeXtreamAccountCompatibility({baseUrl:'https://bfy.up.railway.app',
    username:'testUser',password:'testPass',fetchImpl:client.fetchImpl});
  assert.equal(r.ok,true);assert.equal(r.code,'xtream_login_compatible');
  assert.equal(client.called.length,6);
  assert.deepEqual(r.categories,{live:1,movie:1,series:1});
  assert.equal(JSON.stringify(r).includes('testPass'),false);
  assert.equal(JSON.stringify(r).includes('testUser'),false);
});
test('empty catalog is distinguished from wrong password',async()=>{
  const client=fakeClient({noCatalog:true});
  const r=await probeXtreamAccountCompatibility({baseUrl:'https://bfy.up.railway.app',
    username:'testUser',password:'testPass',fetchImpl:client.fetchImpl});
  assert.equal(r.ok,false);assert.equal(r.auth,1);
  assert.equal(r.code,'xtream_catalog_empty');
});
test('POST auth denial flags a client-compat failure',async()=>{
  const client=fakeClient({postDenied:true});
  const r=await probeXtreamAccountCompatibility({baseUrl:'https://bfy.up.railway.app',
    username:'testUser',password:'testPass',fetchImpl:client.fetchImpl});
  assert.equal(r.ok,false);assert.equal(r.failedStep,'postLogin');
  assert.equal(r.reason,'auth_denied');
});
test('one rejected category reports a narrow root cause',async()=>{
  const client=fakeClient({failedAction:'get_vod_categories'});
  const r=await probeXtreamAccountCompatibility({baseUrl:'https://bfy.up.railway.app',
    username:'testUser',password:'testPass',fetchImpl:client.fetchImpl});
  assert.equal(r.ok,false);assert.equal(r.failedStep,'movie');
  assert.equal(r.reason,'http_503');
});

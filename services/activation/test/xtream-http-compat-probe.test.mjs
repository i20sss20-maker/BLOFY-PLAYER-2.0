import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {probeXtreamHttp11} from '../src/xtream-http-compat-probe.mjs';

function fakeTransport({status=200,body='{"user_info":{"auth":1}}',error=null}={}){
 const calls=[];
 return {
  calls,
  request(url,options,onResponse){
   const request=new EventEmitter();
   request.destroy=()=>{};
   request.end=()=>{
    queueMicrotask(()=>{
      if(error){request.emit('error',error);return;}
      const response=new EventEmitter();
      response.statusCode=status;
      onResponse(response);
      if(body)response.emit('data',Buffer.from(body));
      response.emit('end');
    });
   };
   calls.push({url,options});
   return request;
  }
 };
}

test('native HTTP/1.1 closes connection and verifies genuine Xtream account auth',async()=>{
 const transport=fakeTransport({});
 const report=await probeXtreamHttp11('http://source.example:8080/player_api.php?username=hidden&password=secret',{
  checkPublic:async()=>{},httpTransport:transport
 });
 assert.deepEqual(report,{ok:true,stage:'http_response',status:200,code:'xtream_api_reachable'});
 assert.equal(transport.calls.length,1);
 assert.equal(transport.calls[0].options.headers.connection,'close');
 assert.equal(transport.calls[0].options.headers['user-agent'],'BLOFY-Xtream/1.0');
 assert.doesNotMatch(JSON.stringify(report),/hidden|secret|source\.example/);
});
test('upstream HTTP access denied remains denied and is not retried',async()=>{
 for(const status of [401,403,456]){
  const transport=fakeTransport({status,body:''});
  const report=await probeXtreamHttp11('http://source.example/',{
    checkPublic:async()=>{},httpTransport:transport
  });
  assert.equal(report.ok,false);
  assert.equal(report.code,'xtream_http_'+status);
  assert.equal(transport.calls.length,1);
 }
});
test('transport reset stays safe and no source credentials appear',async()=>{
 const error=Object.assign(new Error('upstream failed with token=SECRET'),{code:'ECONNRESET'});
 const transport=fakeTransport({error});
 const report=await probeXtreamHttp11('http://source.example:8080/player_api.php?password=secret',{
  checkPublic:async()=>{},httpTransport:transport
 });
 assert.equal(report.code,'xtream_transport_connection_reset');
 assert.equal(report.ok,false);
 assert.doesNotMatch(JSON.stringify(report),/secret|SECRET|source\.example/);
});
test('HTML or unauthenticated JSON does not masquerade as Xtream success',async()=>{
 for(const body of ['<html>blocked</html>','{"user_info":{"auth":0}}']){
  const transport=fakeTransport({status:200,body});
  const r=await probeXtreamHttp11('http://source.example/',{
   checkPublic:async()=>{},httpTransport:transport
  });
  assert.equal(r.ok,false);
 }
});
test('compatibility comparison is opt-in only and cannot mutate catalog or playback',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf("if(process.env.BLOFY_XTREAM_HTTP11_ONE_SHOT==='1')");
 const end=c.indexOf('// One-time, admin-authorized network diagnosis.',start);
 assert.ok(start>0&&end>start);
 const section=c.slice(start,end);
 assert.match(section,/probeXtreamHttp11/);
 assert.match(section,/BLOFY_XTREAM_HTTP11_COMPARISON/);
 assert.doesNotMatch(section,/UPDATE |INSERT |DELETE |syncServer\(|probeXtreamPlayback\(|console\.log\([^)]*password_secret/);
});

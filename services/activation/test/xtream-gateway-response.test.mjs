import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readXtreamGatewayJsonResponse} from '../src/xtream-gateway-response.mjs';

test('Xtream info parses UTF-8 JSON split at arbitrary byte boundaries',async()=>{
  const original={movie_data:{name:'فيلم عربي 🎬',stream_id:17},info:{year:'2026'}};
  const bytes=Buffer.from(JSON.stringify(original),'utf8');
  const body=new ReadableStream({
    start(controller){
      for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));
      controller.close();
    }
  });
  const parsed=await readXtreamGatewayJsonResponse({
    ok:true,status:200,headers:new Headers(),body
  },{maxBytes:bytes.length});
  assert.deepEqual(parsed,original);
});

test('oversized replies abort the upstream body before buffering the full payload',async()=>{
  let cancelled=false;
  const body=new ReadableStream({
    start(controller){controller.enqueue(Buffer.alloc(80,65));},
    cancel(){cancelled=true;}
  });
  const response={ok:true,status:200,headers:new Headers(),body};
  await assert.rejects(readXtreamGatewayJsonResponse(response,{maxBytes:40}),/xtream_gateway_info_too_large/);
  assert.equal(cancelled,true);
});

test('Content-Length over limit is rejected before consuming response bytes',async()=>{
  let cancelled=false,readAttempted=false;
  const body=new ReadableStream({
    pull(controller){readAttempted=true;controller.enqueue(Buffer.from('{}'));},
    cancel(){cancelled=true;}
  });
  await assert.rejects(readXtreamGatewayJsonResponse({
    ok:true,status:200,headers:new Headers({'content-length':'2000'}),body
  },{maxBytes:100}),/xtream_gateway_info_too_large/);
  assert.equal(cancelled,true);
  // ReadableStream may prefetch proactively; parsing still never calls getReader.
  assert.equal(body.locked,false);
});

test('upstream HTTP denials close their body and contain no provider secrets',async()=>{
  let cancelled=false;
  const body=new ReadableStream({
    start(controller){controller.enqueue(Buffer.from('https://private.example/user/password'));},
    cancel(){cancelled=true;}
  });
  await assert.rejects(readXtreamGatewayJsonResponse({
    ok:false,status:403,headers:new Headers(),body
  }),error=>error.message==='xtream_gateway_upstream_403');
  assert.equal(cancelled,true);
});

test('JSON and network read failures return stable safe errors',async()=>{
  await assert.rejects(readXtreamGatewayJsonResponse(new Response('<html>secret</html>')),
    error=>error.message==='xtream_gateway_upstream_json_invalid');
  const body=new ReadableStream({pull(){throw new Error('secret credential in provider stack');}});
  await assert.rejects(readXtreamGatewayJsonResponse({
    ok:true,status:200,headers:new Headers(),body
  }),error=>error.message==='xtream_gateway_upstream_read_failed');
  await assert.rejects(readXtreamGatewayJsonResponse(new Response('{}'),{maxBytes:12_000_001}),
    /xtream_gateway_response_limit_invalid/);
});

test('production Xtream detail path uses bounded reader, never response.text()',async()=>{
  const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=gateway.indexOf('async function fetchUpstreamApi(');
  const end=gateway.indexOf('// Account-scoped program guide',start);
  assert.ok(start>0&&end>start);
  const block=gateway.slice(start,end);
  assert.match(block,/return readXtreamGatewayJsonResponse\(response\)/);
  assert.doesNotMatch(block,/response\.text\(/);
});

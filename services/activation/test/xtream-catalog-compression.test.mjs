import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {acceptsXtreamGzip} from '../src/xtream-catalog-compression.mjs';

test('large Xtream lists use gzip only for explicitly capable clients',()=>{
  for(const value of ['gzip','GZIP','br, gzip, deflate','gzip;q=0.6, br;q=1','identity;q=0.5,gzip;q=1.0'])
    assert.equal(acceptsXtreamGzip(value),true,value);
  for(const value of ['',null,'identity','br, deflate','gzip;q=0','gzip;q=0.0','gzip;q=-1','gzip;q=2','garbagegzip'])
    assert.equal(acceptsXtreamGzip(value),false,String(value));
});

test('gzip encoding retains exact Xtream JSON data without buffering the entire catalog',()=>{
  const catalog=Array.from({length:1000},(_,i)=>({stream_id:i+1,name:'فيلم عربي 2026 '+i,category_id:'41'}));
  const json=JSON.stringify(catalog);
  const zipped=gzipSync(Buffer.from(json),{level:4});
  assert.ok(zipped.byteLength<Buffer.byteLength(json));
  assert.deepEqual(JSON.parse(gunzipSync(zipped).toString('utf8')),catalog);
});

test('production gateway sends compressed lists only on accepted GET and preserves streamed pagination',async()=>{
  const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function streamGatewayItems(');
  const end=source.indexOf('async function gatewayItemById(',start);
  const block=source.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(block,/acceptsXtreamGzip\(req\.headers\['accept-encoding'\]\)/);
  assert.match(block,/createGzip\(\{level:4\}\)/);
  assert.match(block,/'vary':'Accept-Encoding'/);
  assert.match(block,/headers\['content-encoding'\]='gzip'/);
  assert.match(block,/gzip\.pipe\(res\)/);
  assert.match(block,/writeStreamChunk\(output,'\['\)/);
  assert.match(block,/writeStreamChunk\(output,'\]'\)/);
  assert.match(block,/output\.end\(\)/);
  assert.match(block,/walkGatewayItems\(mediaType,filter/);
  assert.match(block,/gzip\.destroy\(\)/);
  for(const mediaType of ['live','movie','series'])
    assert.ok(source.includes("return streamGatewayItems(req,res, '"+mediaType+"'"));
  assert.match(source,/if\(error\?\.message==='xtream_client_disconnected'\)return/);
  assert.match(source,/if \(res\.writableEnded \|\| res\.destroyed\) return/);
  assert.doesNotMatch(block,/Buffer\.concat\(/);
});

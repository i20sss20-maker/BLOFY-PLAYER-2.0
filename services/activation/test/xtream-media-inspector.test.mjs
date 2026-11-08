import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectXtreamMediaChunk} from '../src/xtream-media-inspector.mjs';
import {verifiedXtreamMediaContentType} from '../src/xtream-media-response-type.mjs';

const probe=(text,type)=>inspectXtreamMediaChunk(Buffer.from(text),type);

test('an Xtream movie returning HTTP 200 with HTML or JSON is not playable',()=>{
  for(const [sample,type] of [
    ['<!doctype html><html>Access denied</html>','text/html'],
    ['<html>404 Not Found</html>','application/octet-stream'],
    ['{"error":"File not found"}','application/octet-stream'],
    ['{"message":"Expired account"}','application/json'],
    ['Access denied: no source permissions','text/plain'],
    ['Forbidden','application/octet-stream'],
    ['Not found','text/plain']
  ]){
    const result=probe(sample,type);
    assert.equal(result.valid,false,sample);
    assert.equal(result.reason,'upstream_non_media_response');
  }
});

test('recognize valid TS, MP4, MKV, AVI, HLS and leave unknown binary allowed',()=>{
  const ts=Buffer.alloc(376,0x41);ts[0]=0x47;ts[188]=0x47;
  assert.deepEqual(inspectXtreamMediaChunk(ts,'video/mp2t'),{valid:true,format:'ts',reason:null});
  assert.equal(probe('\x00\x00\x00\x18ftypisom', 'video/mp4').format,'mp4');
  assert.equal(inspectXtreamMediaChunk(Buffer.from([0x1a,0x45,0xdf,0xa3,0x93]),'application/octet-stream').format,'mkv');
  assert.equal(probe('RIFF0000AVI LIST','video/x-msvideo').format,'avi');
  assert.deepEqual(probe('#EXTM3U\n#EXTINF:10,','text/plain'),{valid:true,format:'hls',reason:null});
  assert.deepEqual(inspectXtreamMediaChunk(Buffer.from([0xaf,0x23,0x80,0x35,0x91]),'application/octet-stream'),
    {valid:true,format:'unknown',reason:null});
  assert.equal(inspectXtreamMediaChunk(Buffer.alloc(0),'video/mp4').valid,false);
});

test('gateway and all three upstream probe types share the same media validator',async()=>{
  const [gateway,admin]=await Promise.all([
    readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8')
  ]);
  assert.match(gateway,/import \{ inspectXtreamMediaChunk \}/);
  assert.match(admin,/import \{ inspectXtreamMediaChunk \}/);
  assert.ok(gateway.split('inspectXtreamMediaChunk(first.value,').length>=3,
    'gateway player and item probe');
  assert.ok(admin.split('inspectXtreamMediaChunk(first.value,').length>=3,
    'movie/live and series episode probe');
  assert.match(gateway,/if\(!inspection\.valid\)throw new Error\(inspection\.reason\)/);
  assert.match(gateway,/if\(!inspection\.valid\)\s*return\{ok:false/);
  assert.match(admin,/if\(!inspection\.valid\)errorCode=inspection\.reason/);
  assert.doesNotMatch(gateway,/console\.warn\([^\n]*upstream\.toString/);
});

test('fake video HTTP 200 bodies containing provider 404/502 are rejected',()=>{
 for(const sample of ['404 Not Found','404: Not Found','403 Forbidden',
   '502 Bad Gateway','503 Service Unavailable','504 Gateway Timeout']){
   const inspected=probe(sample,'video/mp4');
   assert.equal(inspected.valid,false,sample);
   assert.equal(inspected.reason,'upstream_non_media_response',sample);
 }
 assert.equal(inspectXtreamMediaChunk(Buffer.from([0xaf,0x23,0x80,0x35,0x91]),
   'application/octet-stream').valid,true);
});

test('generic media headers adopt ONLY signatures actually verified from bytes',()=>{
 for(const [format,mime] of [['mp4','video/mp4'],['mkv','video/x-matroska'],
   ['avi','video/x-msvideo'],['ts','video/mp2t'],
   ['hls','application/vnd.apple.mpegurl']]){
   assert.equal(verifiedXtreamMediaContentType('application/octet-stream',
     {valid:true,format}),mime);
 }
 assert.equal(verifiedXtreamMediaContentType('video/mp4',{valid:true,format:'mkv'}),
   'video/mp4','never overwrite provider explicit mime');
 assert.equal(verifiedXtreamMediaContentType('application/octet-stream',
   {valid:false,format:'mkv'}),'application/octet-stream');
 assert.equal(verifiedXtreamMediaContentType('application/octet-stream',
   {valid:true,format:'unknown'}),'application/octet-stream');
 assert.equal(verifiedXtreamMediaContentType('',{valid:true,format:'mp4'}),'video/mp4');
});

test('verified content-type reaches subscriber stream after media validation',async()=>{
 const c=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(c,/import \{ verifiedXtreamMediaContentType \}/);
 assert.match(c,/verifiedType=verifiedXtreamMediaContentType\(/);
 assert.match(c,/if\(verifiedType\)outputHeaders\['content-type'\]=verifiedType/);
});

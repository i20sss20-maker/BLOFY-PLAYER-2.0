import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createProtectedArabicAudioBridge,sniffFirstAudioMime,audioPayloadClass}
  from '../src/stream-arabic-audio-bridge.mjs';

const playlist=JSON.stringify({playlist:[
  {channel:'Anis Max 1',url:'http://radio.anisfm.vip/live/mx/1?token=FICTIONAL_ONLY'}
]});
function makeBridge(packet,declaredType='text/plain') {
  return createProtectedArabicAudioBridge({
    getPlaylist:()=>playlist,isEnabled:()=>true,
    lookup:async()=>[{address:'8.8.8.8',family:4}],
    createRequest(_options,callback){
      const client=new EventEmitter();
      client.destroy=()=>{};
      client.end=()=>{
        const source=new PassThrough();
        source.statusCode=200;
        source.headers={'content-type':declaredType};
        queueMicrotask(()=>{
          callback(source);
          source.end(packet);
        });
      };
      return client;
    }
  });
}
function fakeResponse(){
  const response=new PassThrough();
  response.headersSent=false;
  response.statusCode=0;
  response.writeHead=(status,headers)=>{
    response.headersSent=true;response.statusCode=status;
    response.outgoingHeaders=headers;return response;
  };
  const chunks=[];
  response.on('data',b=>chunks.push(b));
  return {response,body:()=>Buffer.concat(chunks)};
}

test('detects actual MP3, AAC, OGG, FLAC and TS signatures, rejects fake HTML',()=>{
  assert.equal(sniffFirstAudioMime(Buffer.from('ID3test')),'audio/mpeg');
  assert.equal(sniffFirstAudioMime(Buffer.from([255,251,0,0])),'audio/mpeg');
  assert.equal(sniffFirstAudioMime(Buffer.from([255,241,0,0])),'audio/aac');
  assert.equal(sniffFirstAudioMime(Buffer.from('OggS-')),'audio/ogg');
  assert.equal(sniffFirstAudioMime(Buffer.from('fLaC-')),'audio/flac');
  assert.equal(sniffFirstAudioMime(Buffer.from('ADIF-')),'audio/aac');
  assert.equal(sniffFirstAudioMime(Buffer.from([0,0,0,20,102,116,121,112,77,52,65,32])),'audio/mp4');
  const transport=Buffer.alloc(377);transport[0]=71;transport[188]=71;transport[376]=71;
  assert.equal(sniffFirstAudioMime(transport),'video/mp2t');
  assert.equal(sniffFirstAudioMime(Buffer.from('<!doctype html>Denied')) ,null);
});

test('real audio packets pass even when provider incorrectly says text/plain',async()=>{
  const packet=Buffer.from('ID3mock-audio-packet');
  const bridge=makeBridge(packet);
  const {response,body}=fakeResponse();
  await bridge.stream({method:'GET',headers:{}},response,'anis-max-1','owner-test');
  assert.equal(response.statusCode,200);
  assert.equal(response.outgoingHeaders['content-type'],'audio/mpeg');
  assert.deepEqual(body(),packet);
});

test('HTTP 200 HTML fake audio is rejected and never forwarded',async()=>{
  const bridge=makeBridge(Buffer.from('<!doctype html><html>Access denied</html>'));
  const {response,body}=fakeResponse();
  await bridge.stream({method:'GET',headers:{}},response,'anis-max-1','owner-test');
  assert.equal(response.statusCode,415);
  assert.equal(response.outgoingHeaders['content-type'],'application/json; charset=utf-8');
  assert.equal(body().toString().includes('Access denied'),false);
});

test('source HLS/HTML/JSON are classified safely, without forwarding upstream content',async()=>{
 const cases=[
  ['#EXTM3U\n#EXT-X-VERSION:3\n','hls_playlist'],
  ['<!doctype html><html>expired token</html>','html_document'],
  ['{"error":"token=private-string"}','json_document']
 ];
 for(const [raw,kind] of cases){
  assert.equal(audioPayloadClass(Buffer.from(raw)),kind);
  const {response,body}=fakeResponse();
  await makeBridge(Buffer.from(raw)).stream(
   {method:'GET',headers:{}},response,'anis-max-1','owner-test'
  );
  assert.equal(response.statusCode,415);
  const err=JSON.parse(body().toString('utf8')).error;
  assert.equal(err,'upstream_'+kind+'_not_progressive_audio');
  assert.equal(JSON.stringify(err).includes('private-string'),false);
  assert.equal(JSON.stringify(err).includes('expired token'),false);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createProtectedArabicAudioBridge} from '../src/stream-arabic-audio-bridge.mjs';

const playlist=JSON.stringify({playlist:[
  {channel:'Anis Max 1',url:'http://radio.anisfm.vip/live/mx/1?token=FICTIONAL_TEST_ONLY'},
  {channel:'Anis Al Kass 1',url:'http://radio.anisfm.vip/live/sha/K1?token=FICTIONAL_TEST_ONLY'}
]});
const dns=async()=>[{address:'203.0.113.19',family:4}];

function httpFixture(status,mime='text/html',data=Buffer.from('unavailable')) {
  return (_options,respond)=>{
    const request=new EventEmitter();
    request.end=()=>{
      const body=new EventEmitter();
      body.statusCode=status;
      body.headers={'content-type':mime};
      body.destroy=()=>{};
      queueMicrotask(()=>{
        respond(body);
        if(status===200){body.emit('data',data);body.emit('end');}
      });
    };
    request.destroy=()=>{};
    return request;
  };
}

test('expired provider token reports status without response body or secret',async()=>{
  const bridge=createProtectedArabicAudioBridge({getPlaylist:()=>playlist,
    isEnabled:()=>true,lookup:dns,createRequest:httpFixture(403)});
  const result=await bridge.probe();
  assert.equal(result.length,2);
  assert.equal(result[0].reason,'upstream_http_status');
  assert.equal(result[0].httpStatus,403);
  assert.equal(JSON.stringify(result).includes('FICTIONAL_TEST_ONLY'),false);
  assert.equal(JSON.stringify(result).includes('radio.anisfm.vip'),false);
});

test('valid radio packet detects audio without streaming full source',async()=>{
  const bridge=createProtectedArabicAudioBridge({getPlaylist:()=>playlist,
    isEnabled:()=>true,lookup:dns,
    createRequest:httpFixture(200,'audio/mpeg',Buffer.from('ID3abcdefgh'))});
  const result=await bridge.probe();
  assert.equal(result[0].reason,'audio_bytes_detected');
  assert.equal(result[0].mime,'audio/mpeg');
});

test('host lookup failures return sanitized reason',async()=>{
  const bridge=createProtectedArabicAudioBridge({getPlaylist:()=>playlist,
    isEnabled:()=>true,lookup:async()=>{throw Error('secret-details');}});
  assert.deepEqual(await bridge.probe(),[{reason:'dns_lookup_failed'}]);
});

test('inactive feature never fetches private upstream',async()=>{
  const bridge=createProtectedArabicAudioBridge({getPlaylist:()=>playlist,
    isEnabled:()=>false,lookup:async()=>{throw Error('must not resolve');}});
  assert.deepEqual(await bridge.probe(),[{reason:'audio_disabled_or_unconfigured'}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOperatorAudioPlaylist,createProtectedArabicAudioBridge}
  from '../src/stream-arabic-audio-bridge.mjs';

// Channel labels and PATH SHAPES reflect the operator's 38-track playlist.
// Credentials are synthetic; real token values NEVER enter this repository.
const fixture={
  "playlist": [
    {
      "channel": "Anis Max 1",
      "url": "http://radio.anisfm.vip/live/mx/1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 2",
      "url": "http://radio.anisfm.vip/live/mx/2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 3",
      "url": "http://radio.anisfm.vip/live/mx/3?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 4",
      "url": "http://radio.anisfm.vip/live/mx/4?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 5",
      "url": "http://radio.anisfm.vip/live/mx/5?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 6",
      "url": "http://radio.anisfm.vip/live/mx/6?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 1",
      "url": "http://radio.anisfm.vip/live/pn/1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 2",
      "url": "http://radio.anisfm.vip/live/pn/2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 3",
      "url": "http://radio.anisfm.vip/live/pn/3?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 4",
      "url": "http://radio.anisfm.vip/live/pn/4?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 5",
      "url": "http://radio.anisfm.vip/live/pn/5?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 6",
      "url": "http://radio.anisfm.vip/live/pn/6?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 7",
      "url": "http://radio.anisfm.vip/live/pn/7?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 8",
      "url": "http://radio.anisfm.vip/live/pn/8?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Sport 9",
      "url": "http://radio.anisfm.vip/live/pn/9?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Italy 1",
      "url": "http://radio.anisfm.vip/live/it/1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Italy 2",
      "url": "http://radio.anisfm.vip/live/it/2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis DE 1",
      "url": "http://radio.anisfm.vip/live/gr/1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis DE 2",
      "url": "http://radio.anisfm.vip/live/gr/2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Thm8h 1",
      "url": "http://radio.anisfm.vip/live/sa/1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Thm8h 2",
      "url": "http://radio.anisfm.vip/live/sa/2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Thm8h 3",
      "url": "http://radio.anisfm.vip/live/sa/3?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Shasha",
      "url": "http://radio.anisfm.vip/live/sha/1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Shahid",
      "url": "http://radio.anisfm.vip/live/sha/2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis EN 1",
      "url": "http://radio.anisfm.vip/live/pn/1EN?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis EN 2",
      "url": "http://radio.anisfm.vip/live/pn/2EN?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis FR 1",
      "url": "http://radio.anisfm.vip/live/pn/1FR?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis FR 2",
      "url": "http://radio.anisfm.vip/live/pn/2FR?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Xtra 1",
      "url": "http://radio.anisfm.vip/live/sha/XR1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Xtra 2",
      "url": "http://radio.anisfm.vip/live/sha/XR2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Al Kass 1",
      "url": "http://radio.anisfm.vip/live/sha/K1?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Al Kass 2",
      "url": "http://radio.anisfm.vip/live/sha/K2?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 1 Low",
      "url": "http://radio.anisfm.vip/live/mx/1L?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 2 Low",
      "url": "http://radio.anisfm.vip/live/mx/2L?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 3 Low",
      "url": "http://radio.anisfm.vip/live/mx/3L?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 4 Low",
      "url": "http://radio.anisfm.vip/live/mx/4L?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 5 Low",
      "url": "http://radio.anisfm.vip/live/mx/5L?token=FICTIONAL_UNIT_TEST_TOKEN"
    },
    {
      "channel": "Anis Max 6 Low",
      "url": "http://radio.anisfm.vip/live/mx/6L?token=FICTIONAL_UNIT_TEST_TOKEN"
    }
  ]
};

test('all 38 operator-provided path shapes pass exact-host allowlist',()=>{
  const parsed=parseOperatorAudioPlaylist(JSON.stringify(fixture));
  assert.equal(parsed.length,38);
  assert.equal(new Set(parsed.map(x=>x.id)).size,38);
  assert.equal(parsed.filter(x=>x.id.startsWith('anis-max-low-')).length,6);
  assert.equal(parsed.filter(x=>x.id.startsWith('anis-alkass-')).length,2);
  const bridge=createProtectedArabicAudioBridge({
    isEnabled:()=>true,getPlaylist:()=>JSON.stringify(fixture)
  });
  const response=bridge.catalog();
  assert.equal(response.status,200);
  assert.equal(response.body.tracks.length,38);
  for(const track of response.body.tracks){
    assert.ok(/^https:\/\/blofyplayer\.com\/api\/v1\/stream\/media\/audio\/anis-/.test(track.playbackUrl));
    assert.ok(!track.playbackUrl.includes('token='));
  }
});

test('operator tokens must be configured; endpoints cannot impersonate private IPs',()=>{
  for(const bad of [
    'http://radio.anisfm.vip.evil.invalid/live/max/1?token=x',
    'http://radio.anisfm.vip:8080/live/max/1?token=x',
    'http://169.254.0.1/live/max/1?token=x',
    'http://radio.anisfm.vip/live/../../private?token=x',
    'https://radio.anisfm.vip/live/max/1?token=x'
  ]){
    const p=JSON.stringify({playlist:[{channel:'Anis Max 1',url:bad}]});
    assert.equal(parseOperatorAudioPlaylist(p).length,0);
  }
});

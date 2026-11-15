import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOperatorAudioPlaylist,createProtectedArabicAudioBridge}
  from '../src/stream-arabic-audio-bridge.mjs';

function playlist() {
  const names=[...Array.from({length:6},(_,i)=>'Anis Max '+(i+1)),
    ...Array.from({length:9},(_,i)=>'Anis Sport '+(i+1)),
    ...Array.from({length:2},(_,i)=>'Anis Italy '+(i+1)),
    ...Array.from({length:2},(_,i)=>'Anis DE '+(i+1)),
    ...Array.from({length:3},(_,i)=>'Anis Thm8h '+(i+1)),
    'Anis Shasha','Anis Shahid',
    ...Array.from({length:2},(_,i)=>'Anis EN '+(i+1)),
    ...Array.from({length:2},(_,i)=>'Anis FR '+(i+1)),
    ...Array.from({length:2},(_,i)=>'Anis Xtra '+(i+1)),
    ...Array.from({length:2},(_,i)=>'Anis Alkass '+(i+1)),
    ...Array.from({length:6},(_,i)=>'Anis Max Low '+(i+1))];
  return JSON.stringify({playlist:names.map((name,i)=>({
    channel:name,url:'http://radio.anisfm.vip/live/radio/'+(i+1)+'?token=secret-value#'
  }))});
}

test('38 operator-only sources appear solely as protected first-party IDs',()=>{
  const raw=playlist(),rows=parseOperatorAudioPlaylist(raw);
  assert.equal(rows.length,38);
  const bridge=createProtectedArabicAudioBridge({getPlaylist:()=>raw,isEnabled:()=>true});
  const {status,body}=bridge.catalog();
  assert.equal(status,200);
  assert.equal(body.tracks.length,38);
  assert.equal(body.tracks[0].id,'anis-max-1');
  assert.equal(body.tracks.at(-1).id,'anis-max-low-6');
  for(const track of body.tracks){
    assert.ok(track.playbackUrl.startsWith('https://blofyplayer.com/api/v1/stream/media/audio/'));
    assert.equal(track.playbackUrl.includes('token='),false);
    assert.equal(track.playbackUrl.includes('radio.anisfm.vip'),false);
  }
  assert.equal(JSON.stringify(body).includes('secret-value'),false);
});

test('disabled or unconfigured relay fails closed',()=>{
  assert.equal(createProtectedArabicAudioBridge({
    getPlaylist:playlist,isEnabled:()=>false
  }).catalog().status,503);
  assert.equal(createProtectedArabicAudioBridge({
    getPlaylist:()=>'',isEnabled:()=>true
  }).catalog().status,503);
});

test('reject unknown networks and private IP source URLs',()=>{
  const urls=['http://127.0.0.1/live/mx/1?token=x',
    'http://169.254.0.5/live/mx/1?token=x',
    'http://radio.anisfm.vip.attacker.invalid/live/mx/1?token=x',
    'http://radio.anisfm.vip:8080/live/mx/1?token=x',
    'https://radio.anisfm.vip/live/mx/1?token=x',
    'http://radio.anisfm.vip/other/secret?token=x',
    'http://user:pass@radio.anisfm.vip/live/mx/1?token=x'];
  for(const url of urls)assert.equal(parseOperatorAudioPlaylist(
    JSON.stringify({playlist:[{channel:'Anis Max 1',url}]})).length,0);
});

test('invalid tokens and duplicates cannot create extra tracks',()=>{
  const rows=[{channel:'Anis Sport 1',url:'http://radio.anisfm.vip/live/radio/1?token=abc'},
    {channel:'Anis Sport 1',url:'http://radio.anisfm.vip/live/radio/2?token=abc'},
    {channel:'My Extra',url:'http://radio.anisfm.vip/live/radio/2'}];
  const parsed=parseOperatorAudioPlaylist(JSON.stringify({playlist:rows}));
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].id,'anis-sport-1');
});

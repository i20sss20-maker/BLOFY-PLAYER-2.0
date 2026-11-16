import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOperatorAudioPlaylist,createProtectedArabicAudioBridge}
  from '../src/stream-arabic-audio-bridge.mjs';

// Mirrors all uploaded FoXFM path groups, without embedding private
// subscriber credentials or altering audio source addresses.
const shapes=[
  ['Live',1,4,'live',8080],['',1,9,'',80],['Xtra',1,3,'xtra',8080],
  ['EN',1,2,'en',8080],['FR',1,2,'fr',8080],
  ['StarzPlay',1,2,'starzplay',8080],
  ['Shasha',1,2,'shasha',8080],
  ['Thmanyah',1,3,'thmanyah',8080],
  ['Shahid',1,2,'shahid',8080],
  ['Alkass',5,8,'alkass',8080]
];
const fixture={playlist:shapes.flatMap(([category,first,last,path,port])=>
  Array.from({length:last-first+1},(_,i)=>{
    const n=first+i;
    return {
      channel:['BLOFY',category,n].filter(Boolean).join(' '),
      url:'http://foxfm.xyz'+(port===8080?':8080':'')+'/'+path+n
    };
  }))};

test('source file maps to exactly 33 BLOFY labels and 33 unique protected playback IDs',()=>{
  const parsed=parseOperatorAudioPlaylist(JSON.stringify(fixture));
  assert.equal(parsed.length,33);
  assert.equal(new Set(parsed.map(x=>x.id)).size,33);
  assert.equal(parsed.filter(x=>x.id.startsWith('anis-alkass-')).length,4);
  assert.equal(parsed.filter(x=>x.id.startsWith('anis-sport-')).length,4);
  assert.equal(parsed.filter(x=>x.id.startsWith('anis-thm8h-')).length,3);
  assert.equal(parsed.filter(x=>x.id.startsWith('anis-max-')).length,9);
  const out=createProtectedArabicAudioBridge({
    getPlaylist:()=>JSON.stringify(fixture),isEnabled:()=>true
  }).catalog();
  assert.equal(out.status,200);
  assert.equal(out.body.tracks.length,33);
  for(const track of out.body.tracks) {
    assert.match(track.playbackUrl,
      /^https:\/\/blofyplayer\.com\/api\/v1\/stream\/media\/audio\/anis-/);
    assert.ok(track.label.startsWith('BLOFY'));
    assert.ok(!JSON.stringify(track).includes('foxfm.xyz'));
  }
});

test('BLOFY public path whitelist rejects injection and wrong endpoint port',()=>{
  for(const url of [
    'http://foxfm.xyz:8080/1', 'http://foxfm.xyz/live1',
    'http://foxfm.xyz:8080/unknown', 'http://foxfm.xyz:8080/live1?token=x',
    'http://foxfm.xyz:8080/live1#fragment', 'http://192.168.1.2/live1',
    'http://foxfm.xyz.evil.invalid:8080/live1'
  ]) {
    const rows=parseOperatorAudioPlaylist(JSON.stringify({playlist:[{
      channel:'BLOFY Live 1',url
    }]}));
    assert.equal(rows.length,0,url);
  }
});

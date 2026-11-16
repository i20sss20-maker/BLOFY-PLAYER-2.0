import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOperatorAudioPlaylist,createProtectedArabicAudioBridge}
  from '../src/stream-arabic-audio-bridge.mjs';

const groups=[
  ['Live',4,'live',8080,1],['',9,'',80,1],
  ['Xtra',3,'xtra',8080,1],['EN',2,'en',8080,1],['FR',2,'fr',8080,1],
  ['StarzPlay',2,'starzplay',8080,1],['Shasha',2,'shasha',8080,1],
  ['Thmanyah',3,'thmanyah',8080,1],['Shahid',2,'shahid',8080,1],
  ['Alkass',4,'alkass',8080,5]
];
function playlist(){
  const result=[];
  for(const [group,count,path,port,start] of groups){
    for(let n=start;n<start+count;n++){
      const channel=['BLOFY',group,n].filter(x=>x!=='').join(' ');
      const url='http://foxfm.xyz'+(port===8080?':8080':'')+'/'+path+n;
      result.push({channel,url});
    }
  }
  return JSON.stringify({playlist:result});
}

test('all 33 source URLs are renamed BLOFY and protected in first party catalog',()=>{
  const raw=playlist(),rows=parseOperatorAudioPlaylist(raw);
  assert.equal(rows.length,33);
  assert.equal(new Set(rows.map(x=>x.id)).size,33);
  assert.equal(rows[0].id,'anis-sport-1');
  assert.equal(rows[4].id,'anis-max-1');
  assert.equal(rows.at(-1).id,'anis-alkass-8');
  const bridge=createProtectedArabicAudioBridge({getPlaylist:()=>raw,isEnabled:()=>true});
  const {status,body}=bridge.catalog();
  assert.equal(status,200);
  assert.equal(body.tracks.length,33);
  for(const item of body.tracks){
    assert.ok(item.label.startsWith('BLOFY '));
    assert.ok(item.playbackUrl.startsWith('https://blofyplayer.com/api/v1/stream/media/audio/anis-'));
    assert.ok(!JSON.stringify(item).includes('foxfm.xyz'));
    assert.ok(!/anes|anis/i.test(item.label));
  }
});

test('relay disabled and invalid catalog never publish audio',()=>{
  assert.equal(createProtectedArabicAudioBridge({getPlaylist:playlist,isEnabled:()=>false}).catalog().status,503);
  assert.equal(createProtectedArabicAudioBridge({getPlaylist:()=>'',isEnabled:()=>true}).catalog().status,503);
});

test('deny wrong hosts, ports, credentials, query tokens, paths and private networks',()=>{
  for(const url of [
    'http://127.0.0.1/1','http://169.254.1.2/1',
    'http://foxfm.xyz.evil.invalid/1','https://foxfm.xyz/1',
    'http://foxfm.xyz:8080/1','http://foxfm.xyz/live1',
    'http://foxfm.xyz:8080/private','http://foxfm.xyz:8080/live5',
    'http://foxfm.xyz:8080/live1?token=secret',
    'http://user:pass@foxfm.xyz:8080/live1',
    'http://radio.anisfm.vip/live/mx/1?token=secret'
  ]) {
    assert.equal(parseOperatorAudioPlaylist(JSON.stringify({playlist:[{
      channel:'BLOFY Live 1',url
    }]})).length,0,url);
  }
});

test('duplicate source labels and non-BLOFY names do not appear',()=>{
  const values=[
    {channel:'BLOFY Live 1',url:'http://foxfm.xyz:8080/live1'},
    {channel:'BLOFY Live 1',url:'http://foxfm.xyz:8080/live2'},
    {channel:'FoX FM Live 2',url:'http://foxfm.xyz:8080/live2'}
  ];
  const parsed=parseOperatorAudioPlaylist(JSON.stringify({playlist:values}));
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].id,'anis-sport-1');
});

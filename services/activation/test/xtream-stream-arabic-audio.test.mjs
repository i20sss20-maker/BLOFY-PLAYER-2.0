import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStreamArabicAudioRegistry,permittedArabicAudioUrl,
  sealArabicAudioUrl,openArabicAudioUrl
} from '../src/xtream-stream-arabic-audio.mjs';

const key='b'.repeat(64);
const permitted='https://audio.example.org/live/ar.mp3?ticket=private-token';

function memoryPool(){
  const items=new Map();
  return {
    items,
    async query(sql,values=[]){
      if(sql.includes('CREATE TABLE'))return {rows:[]};
      if(sql.includes('INSERT INTO blofy_stream_arabic_audio')){
        const [id,channel_id,label,sealed_source_url,delay_seconds]=values;
        items.set(id,{id,channel_id,label,sealed_source_url,
          delay_seconds,format:'progressive',enabled:true});
        return {rows:[]};
      }
      if(sql.includes('WHERE channel_id=$1')){
        return{rows:[...items.values()].filter(x=>String(x.channel_id)===values[0])};
      }
      if(sql.includes('WHERE id=$1 LIMIT 1')){
        return{rows:[...items.values()].filter(x=>x.id===values[0])};
      }
      if(sql.includes('DELETE FROM blofy_stream_arabic_audio')){
        const ok=items.delete(values[0]);return{rowCount:ok?1:0,rows:[]};
      }
      throw Error('unexpected SQL');
    }
  };
}

test('feature is closed by default, no subscriber catalog or source changes',async()=>{
  const catalog=createStreamArabicAudioRegistry({pool:memoryPool(),keyHex:key});
  assert.equal(catalog.configured(),false);
  await assert.rejects(catalog.catalog('555'),/arabic_audio_not_enabled/);
});

test('audio host is explicit, HTTPS-only, non-private and never includes userinfo',()=>{
  const hosts=new Set(['audio.example.org']);
  assert.equal(permittedArabicAudioUrl(permitted,hosts),true);
  for(const candidate of [
    'http://audio.example.org/live/a.mp3',
    'https://user:pass@audio.example.org/live/a.mp3',
    'https://audio.example.org.evil.test/live/a.mp3',
    'https://audio.example.org:9000/live/a.mp3',
    'https://localhost/live/a.mp3',
    'https://audio.example.org/',
    'https://audio.example.org/live/a.mp3#fragment'
  ])assert.equal(permittedArabicAudioUrl(candidate,hosts),false,candidate);
});

test('audio source is encrypted at rest and catalog exposes only authorized proxy route',async()=>{
  const pool=memoryPool();
  const registry=createStreamArabicAudioRegistry({
    pool,keyHex:key,enabled:true,allowedSourceHosts:'audio.example.org'
  });
  assert.equal(registry.configured(),true);
  const track=await registry.register({
    channelId:'54321',label:'التعليق العربي',
    sourceUrl:permitted,delaySeconds:4,confirmAuthorizedAudio:true
  });
  const stored=[...pool.items.values()][0];
  assert.equal(stored.channel_id,'54321');
  assert.equal(stored.sealed_source_url.includes('ticket'),false);
  assert.equal(openArabicAudioUrl(stored.sealed_source_url,key),permitted);
  assert.notEqual(sealArabicAudioUrl(permitted,key),stored.sealed_source_url);
  const available=await registry.catalog('54321');
  assert.equal(available.length,1);
  assert.equal(available[0].playbackUrl,
    'https://blofyplayer.com/api/v1/stream/media/audio/'+track.id);
  assert.equal(available[0].format,'progressive');
  assert.equal(available[0].delaySeconds,4);
  assert.equal(JSON.stringify(available).includes('private-token'),false);
  assert.equal((await registry.lookup(track.id)).sourceUrl,permitted);
  assert.equal((await registry.list('54321'))[0].sourceUrl,undefined);
  assert.equal((await registry.catalog('98765')).length,0);
  assert.equal(await registry.remove(track.id),true);
  assert.equal(await registry.lookup(track.id),null);
});

test('rights acknowledgement, channel, label and offset must be valid',async()=>{
  const registry=createStreamArabicAudioRegistry({
    pool:memoryPool(),keyHex:key,enabled:true,
    allowedSourceHosts:'audio.example.org'
  });
  const valid={channelId:'123',label:'Arabic',sourceUrl:permitted,
    delaySeconds:0,confirmAuthorizedAudio:true};
  for(const body of [
    {...valid,confirmAuthorizedAudio:false},
    {...valid,channelId:'0'},
    {...valid,channelId:'abc'},
    {...valid,label:''},
    {...valid,delaySeconds:-1},
    {...valid,delaySeconds:31},
    {...valid,sourceUrl:'https://evil.example.com/audio.mp3'}
  ])await assert.rejects(registry.register(body));
});

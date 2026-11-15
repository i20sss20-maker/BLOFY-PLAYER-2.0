import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 ANIS_AUDIO_TRACKS,anisAudioPublicCatalog,
 anisAudioEnabled,anisAudioSourceFor
} from '../src/stream-anis-audio.mjs';

const TEST_TOKEN='TEST_ONLY_Audio_Token_001';

test('Anis FM M3U and JSON describe 38 distinct streams in 12 groups',()=>{
 assert.equal(ANIS_AUDIO_TRACKS.length,38);
 assert.equal(new Set(ANIS_AUDIO_TRACKS.map(t=>t.id)).size,38);
 assert.equal(new Set(ANIS_AUDIO_TRACKS.map(t=>t.label)).size,38);
 assert.deepEqual(ANIS_AUDIO_TRACKS.slice(0,3).map(t=>t.label),
   ['Anis Max 1','Anis Max 2','Anis Max 3']);
 assert.equal(ANIS_AUDIO_TRACKS.find(t=>t.id==='anis-sport-9').sourcePath,'/live/pn/9');
 assert.equal(ANIS_AUDIO_TRACKS.find(t=>t.id==='anis-en-2').sourcePath,'/live/pn/2EN');
 assert.equal(ANIS_AUDIO_TRACKS.find(t=>t.id==='anis-fr-1').sourcePath,'/live/pn/1FR');
 assert.equal(ANIS_AUDIO_TRACKS.find(t=>t.id==='anis-max-low-6').sourcePath,'/live/mx/6L');
});

test("customer response contains only the app's authenticated HTTPS proxy URLs",()=>{
 const catalogue=anisAudioPublicCatalog();
 assert.equal(catalogue.length,38);
 for(const track of catalogue){
   assert.match(track.playbackUrl,
     /^https:\/\/blofyplayer\.com\/api\/v1\/stream\/media\/audio\/anis-[a-z0-9-]+$/);
   assert.ok(!JSON.stringify(track).includes('radio.anisfm.vip'));
   assert.ok(!JSON.stringify(track).includes('?token='));
 }
});

test('upstream URLs are created exclusively for known fixed paths and valid runtime token',()=>{
 assert.equal(anisAudioSourceFor('anis-max-1',TEST_TOKEN),
   'http://radio.anisfm.vip/live/mx/1?token='+TEST_TOKEN);
 for(const id of ['invalid','../','anis-max-7','https://evil.example.com']) {
   assert.equal(anisAudioSourceFor(id,TEST_TOKEN),null);
 }
 assert.equal(anisAudioSourceFor('anis-max-1','bad&token=other'),null);
 assert.equal(anisAudioSourceFor('anis-max-1',''),null);
});

test('all feeds are disabled unless both explicit owner approval flag and token exist',()=>{
 assert.equal(anisAudioEnabled({}),false);
 assert.equal(anisAudioEnabled({BLOFY_STREAM_ANIS_AUDIO_ENABLED:'1'}),false);
 assert.equal(anisAudioEnabled({
    BLOFY_STREAM_ANIS_TOKEN:TEST_TOKEN
 }),false);
 assert.equal(anisAudioEnabled({
    BLOFY_STREAM_ANIS_AUDIO_ENABLED:'1',BLOFY_STREAM_ANIS_TOKEN:TEST_TOKEN
 }),true);
});

test('STREAM code authentication wraps catalog and media, never leaks source on error',async()=>{
 const gateway=await readFile(
  new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(gateway,/async function handleCodeProtectedAnisAudio/);
 assert.match(gateway,/const account=await authenticateAppBearer\(req\)/);
 assert.match(gateway,/if\(!account\)return json\(res,401/);
 assert.match(gateway,/anisAudioEnabled\(\)\?anisAudioPublicCatalog\(\):\[\]/);
 assert.match(gateway,/redirect:'manual'/);
 assert.match(gateway,/const supported=new Set/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioSlots,audioContainer,audioWorkerHost} from '../audio-worker-policy.mjs';
test('audio slot stays occupied until explicit process release',()=>{
 const slots=createAudioSlots(),release=slots.acquire('opaque-a');
 assert.ok(release);assert.equal(slots.acquire('opaque-a'),null);assert.equal(slots.acquire('opaque-b'),null);
 assert.deepEqual(slots.snapshot(),{active:1,limit:1,denied:2});
 release();release();assert.equal(slots.snapshot().active,0);assert.ok(slots.acquire('opaque-b'));
});
test('only known audio containers and exact private worker routes are accepted',()=>{
 assert.equal(audioContainer('Video/MP2T; charset=binary'),'video/mp2t');
 for(const v of ['text/html','application/json','application/octet-stream','audio/x-unknown'])assert.equal(audioContainer(v),null);
 assert.equal(audioWorkerHost('isolated'),'http://blofy-stream-web-audio.railway.internal:8080');
 assert.equal(audioWorkerHost(''),'http://blofy-stream-web-media.railway.internal:8080');
 assert.equal(audioWorkerHost('http://127.0.0.1'),null);
});

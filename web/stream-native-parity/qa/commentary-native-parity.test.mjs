import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {channelTracks,publicCommentaryTracks,safeCommentaryUrl,validCommentaryChannel}
 from '../commentary-policy.mjs';

const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const sidecar=readFileSync(new URL('../stream-commentary.js',import.meta.url),'utf8');

test('commentators belong to selected channel and never expose private source URLs',()=>{
 const raw={channels:[{channelId:'42',tracks:[{
   id:'anis-max-01',label:'أنيس • المعلق',playbackUrl:'https://blofyplayer.com/api/v1/stream/media/audio/voice.mp3',
   format:'progressive',delaySeconds:2
 }]},{channelId:'43',tracks:[{
   id:'anis-max-02',label:'آخر',playbackUrl:'https://blofyplayer.com/api/v1/stream/media/audio/other.mp3'
 }]}]};
 const list=channelTracks(raw,'42');
 assert.equal(list.length,1);
 assert.equal(list[0].label,'بلوفي • المعلق');
 assert.equal(list[0].delaySeconds,2);
 assert.deepEqual(publicCommentaryTracks(list),[{
   id:'anis-max-01',label:'بلوفي • المعلق',delaySeconds:2,format:'progressive'
 }]);
 assert.equal(JSON.stringify(publicCommentaryTracks(list)).includes('playbackUrl'),false);
 assert.equal(JSON.stringify(publicCommentaryTracks(list)).includes('source'),false);
 assert.equal(channelTracks(raw,'44').length,0);
});
test('block unsafe audio sources, untrusted redirects and malformed channel identifiers',()=>{
 for(const url of [
  'http://blofyplayer.com/api/v1/stream/media/audio/test',
  'https://internal.local/api/v1/stream/media/audio/test',
  'https://blofyplayer.com.evil.test/api/v1/stream/media/audio/test',
  'https://attacker@blofyplayer.com/api/v1/stream/media/audio/test',
  'https://blofyplayer.com/api/v1/stream/media/movie/3.mp4',
  'https://blofyplayer.com/api/v1/stream/media/audio/../../private',
  'https://blofyplayer.com:444/api/v1/stream/media/audio/test',
 ])
  assert.equal(safeCommentaryUrl(url),false,url);
 assert.equal(validCommentaryChannel('abc_42'),true);
 assert.equal(validCommentaryChannel('../abc'),false);
 assert.equal(channelTracks({tracks:[{id:'x',label:'x',playbackUrl:'https://example.com/a.mp3'}]},'abc').length,0);
});
test('commentary feature is isolated, gate-closed, and restores original LIVE audio',()=>{
 assert.match(server,/BLOFY_WEB_COMMENTARY_ENABLED!=='1'/);
 assert.match(server,/\/api\/v1\/stream\/audio\/catalog/);
 assert.match(server,/if\(!h\)return json\(401/);
 assert.match(server,/publicCommentaryTracks/);
 assert.match(server,/safeCommentaryUrl/);
 assert.match(server,/commentary_hls_not_ready/);
 assert.match(sidecar,/video\.muted=true/);
 assert.match(sidecar,/function restore\(\)/);
 assert.match(sidecar,/audio\.pause\(\)/);
 assert.match(js,/player-commentary-more/);
 assert.match(js,/function showCommentators\(/);
 assert.match(js,/state\.commentary\.destroy\(\)/);
});

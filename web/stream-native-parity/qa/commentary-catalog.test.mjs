import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeCommentaryTracks,boundedCommentaryJson,validCommentaryId} from '../commentary-catalog.mjs';
const row={id:'anis-max-1',label:'بلوفي ماكس',format:'progressive',delaySeconds:0,playbackUrl:'https://blofyplayer.com/api/v1/stream/media/audio/anis-max-1'};
test('only approved track IDs and exact first-party URLs are accepted',()=>{
 const tracks=safeCommentaryTracks({tracks:[row,row,{...row,id:'../../media'},{...row,id:'anis-evil',playbackUrl:'https://example.org/audio'},{...row,id:'anis-hls',format:'hls'}]},'1');
 assert.deepEqual(tracks,[{id:row.id,label:row.label,delaySeconds:0}]);
 assert.equal(validCommentaryId('anis-../secret'),false);
 assert.deepEqual(safeCommentaryTracks({channels:[{channelId:'2',tracks:[row]}]},'1'),[]);
});
test('catalog input is bounded and rejects malformed JSON',async()=>{
 assert.deepEqual(await boundedCommentaryJson(new Response(JSON.stringify({tracks:[row]}))),{tracks:[row]});
 await assert.rejects(boundedCommentaryJson(new Response('x'.repeat(262145))),/catalog_too_large/);
 await assert.rejects(boundedCommentaryJson(new Response('invalid')));
});
test('same-origin audio stays authenticated and player restores original on failure and exit',()=>{
 const server=readFileSync('server.ts','utf8'),app=readFileSync('app.js','utf8');
 assert.match(server,/ORIGIN\+'\/api\/v1\/stream\/media\/audio\/'\+id/);
 assert.match(server,/headers:\{Authorization:h.Authorization,Accept:'audio\/\*'\},redirect:'manual',signal:req.signal/);
 assert.match(app,/audio.src='\/api\/commentary\/'\+enc\(track.id\)/);
 assert.match(app,/audio.onplaying=function\(\)/);
 assert.match(app,/video.muted=old.originalMuted/);
 assert.match(app,/if\(S.playerView.disposeCommentary\)S.playerView.disposeCommentary\(\)/);
 assert.match(app,/if\(state.stopCommentary\)state.stopCommentary\(\)/);
 assert.match(app,/document.removeEventListener\('visibilitychange',commentaryVisibility\)/);
});

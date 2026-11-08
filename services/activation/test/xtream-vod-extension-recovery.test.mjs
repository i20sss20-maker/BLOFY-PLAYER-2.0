import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mayRefreshMovieExtension,correctedMovieExtension}
  from '../src/xtream-vod-extension-recovery.mjs';

const source='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const different='d2bb0397-1c56-4751-adc9-1a17758022f6';
const enabled={BLOFY_XTREAM_MOVIE_EXTENSION_REFRESH_ENABLED:'1',
 BLOFY_XTREAM_MOVIE_EXTENSION_REFRESH_SOURCE_IDS:source};

test('movie extension repair is default OFF and limited to the selected source',()=>{
 assert.equal(mayRefreshMovieExtension(source,{}),false);
 assert.equal(mayRefreshMovieExtension(source,enabled),true);
 assert.equal(mayRefreshMovieExtension(different,enabled),false);
 assert.equal(mayRefreshMovieExtension(source,{...enabled,
   BLOFY_XTREAM_MOVIE_EXTENSION_REFRESH_ENABLED:'0'}),false);
 assert.equal(mayRefreshMovieExtension(source,{...enabled,
   BLOFY_XTREAM_MOVIE_EXTENSION_REFRESH_SOURCE_IDS:'invalid'}),false);
});
test('only same-ID fresh provider movie data can offer a different whitelisted extension',()=>{
 assert.equal(correctedMovieExtension({
   movie_data:{stream_id:31,container_extension:'.mkv'}},'31','mp4'),'mkv');
 for(const data of [
   {movie_data:{stream_id:32,container_extension:'mkv'}},
   {movie_data:{stream_id:31,container_extension:'mp4'}},
   {movie_data:{container_extension:'mkv'}},
   {movie_data:{stream_id:31,container_extension:'../mkv'}},
   {movie_data:{stream_id:31,container_extension:'m3u8'}},
   {info:{container_extension:'mkv'}},null,[],{}
 ])assert.equal(correctedMovieExtension(data,'31','mp4'),null);
});
test('gateway recovers a movie only after real 404, bounded metadata and matching item ID',async()=>{
 const c=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf('async function freshAdvertisedMovieExtension(');
 const b=c.indexOf('// Explicit operator-only probe.',a);
 const s=c.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(s,/get_vod_info/);
 assert.match(s,/vod_id:String\(sourceId\)/);
 assert.match(s,/24576/);
 assert.match(s,/correctedMovieExtension\(payload,sourceId,previousExtension\)/);
 assert.match(s,/movieRefreshAllowed=kind==='movie'&&req.method==='GET'/);
 assert.match(s,/!retryWithoutRange&&\(response.status===404\|\|confirmedMissing\)/);
 assert.match(s,/extensionRefreshTried=true/);
 assert.match(s,/mediaUpstreamUrl\(row,kind,sourceId,freshExtension\)/);
 assert.doesNotMatch(s,/UPDATE blofy_xtream_items|DELETE FROM blofy_xtream_items/);
});

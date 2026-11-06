import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {tmdbConfigured,validatedTmdbId,normalizeTmdbDetails,fetchTmdbDetails}
  from '../src/xtream-tmdb.mjs';
import {mergedXtreamMetadata} from '../src/xtream-item-details.mjs';

test('commercial TMDB remains disabled without both an approved license and token',()=>{
  assert.equal(tmdbConfigured({}),false);
  assert.equal(tmdbConfigured({BLOFY_TMDB_READ_ACCESS_TOKEN:'x'.repeat(50)}),false);
  assert.equal(tmdbConfigured({BLOFY_TMDB_COMMERCIAL_LICENSE_CONFIRMED:'1'}),false);
  assert.equal(tmdbConfigured({BLOFY_TMDB_COMMERCIAL_LICENSE_CONFIRMED:'1',
    BLOFY_TMDB_READ_ACCESS_TOKEN:'x'.repeat(50)}),true);
  assert.equal(validatedTmdbId('343611'),'343611');
  for(const value of ['../test','0','1/3','123?key=secret','001','x',''])assert.equal(validatedTmdbId(value),null);
});

test('known TMDB ID enriches movie with safe official images and actual credits',()=>{
  const x=normalizeTmdbDetails('movie',{
    id:343611,overview:'قصة اختبار',release_date:'2026-06-19',vote_average:7.92,
    genres:[{name:'أكشن'},{name:'دراما'}],
    poster_path:'/image123.jpg',backdrop_path:'/bg45.webp',
    credits:{cast:[{name:'ممثل أول'},{name:'ممثل ثاني'}],crew:[{name:'مخرج',job:'Director'}]},
    videos:{results:[{site:'YouTube',type:'Trailer',key:'aB12cdEFGhI'}]}
  },'343611');
  assert.equal(x.metadata.plot,'قصة اختبار');
  assert.equal(x.metadata.year,'2026');
  assert.equal(x.metadata.cast,'ممثل أول، ممثل ثاني');
  assert.equal(x.metadata.director,'مخرج');
  assert.equal(x.metadata.genre,'أكشن، دراما');
  assert.equal(x.metadata.rating,'7.9');
  assert.equal(x.artworkUrl,'https://image.tmdb.org/t/p/w500/image123.jpg');
  assert.deepEqual(x.metadata.backdropPath,['https://image.tmdb.org/t/p/w780/bg45.webp']);
  assert.match(x.metadata.youtubeTrailer,/youtube.com\/watch\?v=/);
  assert.throws(()=>normalizeTmdbDetails('movie',{id:88,overview:'other'},'343611'),/tmdb_id_mismatch/);
  assert.equal(normalizeTmdbDetails('series',{id:123,poster_path:'https://evil.test/x.jpg'},'123').artworkUrl,null);
});

test('TMDB exact-ID lookup uses fixed TLS host and bearer in headers only',async()=>{
  let request;
  const result=await fetchTmdbDetails('series','123',{
    token:'fake-test-bearer',
    fetcher:async(url,options)=>{
      request={url,options};
      return {ok:true,status:200,
        body:Readable.from([Buffer.from(JSON.stringify({
          id:123,overview:'TV series',first_air_date:'2025-01-01',
          vote_average:8.2,poster_path:'/tv123.jpg'
        }))])};
    }
  });
  assert.equal(result.metadata.year,'2025');
  assert.match(request.url,/^https:\/\/api\.themoviedb\.org\/3\/tv\/123\?/);
  assert.equal(request.options.headers.authorization,'Bearer fake-test-bearer');
  assert.ok(!request.url.includes('fake-test-bearer'));
  assert.equal(request.options.redirect,'error');
  await assert.rejects(fetchTmdbDetails('movie','abc',{token:'abc'}),/tmdb_invalid_selection/);
  await assert.rejects(fetchTmdbDetails('movie','123',{token:''}),/tmdb_not_configured/);
});

test('TMDB fields persist across Xtream sync and display to player only after verified import',async()=>{
  const [admin,js,html]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8')
  ]);
  assert.match(admin,/metadata->'tmdbDetails'/);
  assert.match(admin,/jsonb_build_object\('tmdbDetails',\$4::jsonb\)/);
  assert.match(admin,/if\(!tmdbConfigured\(\)\)/);
  assert.match(admin,/validatedTmdbId\(mergedXtreamMetadata\(row.metadata\)\.tmdb\)/);
  assert.match(admin,/tmdb\/status/);
  assert.match(admin,/tmdb-enrich/);
  assert.match(js,/let tmdbMetadataAvailable=false/);
  assert.match(js,/if\(tmdbMetadataAvailable&&/);
  assert.match(js,/\/tmdb-enrich'/);
  assert.match(html,/This product uses the TMDB API but is not endorsed or certified by TMDB/);
  assert.match(html,/id="tmdbAttribution"/);
  const combined=mergedXtreamMetadata({plot:null,sourceDetails:{plot:'source story'},tmdbDetails:{plot:'TMDB story'}});
  assert.equal(combined.plot,'TMDB story');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetadataMatcher,normalizeTmdbCandidates,
 validateMatchRequest,scoreMetadataCandidate,deriveEpisodeTitleHints}
 from '../src/metadata-matcher.mjs';
import {createContentHubServer} from '../src/server.mjs';
const key='series:987654321';
const base={key,query:'Neon Voyage',year:2025,language:'en-US'};
test('validation prevents arbitrary URLs, bad languages and media keys',()=>{
 assert.equal(validateMatchRequest(base).kind,'series');
 assert.equal(validateMatchRequest({...base,key:'movie:movie_123456789'}).kind,'movie');
 for(const invalid of [
  {key:'../movies'}, {query:'http://169.254.169.254/latest/'},
  {query:'<img src=x>'}, {query:'\n'},
  {query:'x'}, {language:'xx-YY'}, {year:2099}
 ]){
  assert.throws(()=>validateMatchRequest({...base,...invalid}),
   /metadata_match_invalid/);
 }
});
test('candidate ranking, titles, poster paths and genres are normalized safely',()=>{
 const result=normalizeTmdbCandidates({results:[
  {id:11,title:'Neon Voyage',release_date:'2025-03-17',
   overview:'A sci-fi adventure',poster_path:'/AbCde123456.jpg',
   genre_ids:[878,12]},
  {id:12,title:'Neon',release_date:'2021-04-05',
   overview:'https://secret.example/?password=a',poster_path:'https://evil.test/poster.svg',
   genre_ids:[9]},
  {id:-1,title:'Bad'},
  {id:14,title:'<svg>Neon Voyage</svg>',poster_path:'/../../oops.jpg'}
 ]},{kind:'movie',query:'Neon Voyage',year:2025});
 assert.equal(result.length,3);
 assert.equal(result[0].title,'Neon Voyage');
 assert.equal(result[0].genre,'science_fiction');
 assert.equal(result[0].year,2025);
 assert.equal(result[0].posterPath,'/AbCde123456.jpg');
 assert.equal(result[0].confidence,100);
 assert.equal(result[0].autoSelected,false);
 assert.ok(result.some(x=>x.posterPath===null));
 assert.equal(JSON.stringify(result).includes('secret.example'),false);
 assert.equal(scoreMetadataCandidate('Neon Voyage','Neon Voyage',2025,2025),100);
 assert.equal(scoreMetadataCandidate('Neon Voyage','Ocean Pilot',2025,2022)<70,true);
});
test('saved episode title hints are marked unverified, bounded and do not fetch',()=>{
 const hints=deriveEpisodeTitleHints([
  'Neon Voyage S01E01','Neon Voyage S01E02',
  'Neon Voyage Episode 3','https://secret.example',
  'الحلقة 4','Planet Nine - الحلقة 8']);
 assert.ok(hints.length<=5);
 assert.equal(hints[0].title,'Neon Voyage');
 assert.ok(hints[0].count>=2);
 assert.equal(hints[0].verifiedTitle,false);
 assert.equal(JSON.stringify(hints).includes('secret.example'),false);
});
test('local series hint extraction works for Arabic numerals, codecs and mixed releases',()=>{
 const titles=[
  'رحلة النجوم - الموسم ١ الحلقة ٢ - البداية.mkv',
  'رحلة النجوم - الموسم ١ الحلقة ٣ - النهاية',
  'Solar Mission S01E02 - The Start 1080p WEB-DL.mkv',
  'Solar Mission 1x03 - The Next',
  'Episode 4 - One-Off Individual Episode',
  'الحلقة ٥ - اسم الحلقة فقط',
  'Random Show password=private123 S01E01',
  'Random Show token=private_token S01E02',
  'https://secret.example/path/series_name',
  '1080p WEBRip'
 ];
 const hints=deriveEpisodeTitleHints(titles);
 const ar=hints.find(x=>x.title==='رحلة النجوم');
 const en=hints.find(x=>x.title==='Solar Mission');
 assert.ok(ar,'Arabic title extracted');
 assert.ok(en,'English S01E and 1x episode title extracted');
 assert.equal(ar.count,2);
 assert.equal(en.count,2);
 assert.equal(ar.confidenceLabel,'repeated_saved_heading');
 assert.equal(ar.manualReviewOnly,true);
 assert.equal(hints.some(x=>/password|token|secret/i.test(x.title)),false);
 assert.equal(hints.some(x=>x.title.includes('One-Off')),false);
 assert.equal(hints.every(x=>x.autoSelected===false&&x.verifiedTitle===false),true);
});

test('commercial license and token are mandatory before external request',async()=>{
 let requests=0;
 const fetchImpl=async()=>{requests++;throw Error('should never call')};
 for(const input of [
  {token:'',commercialLicenseConfirmed:true},
  {token:'q'.repeat(40),commercialLicenseConfirmed:false}
 ]){
  const matcher=createMetadataMatcher({...input,fetchImpl});
  assert.equal(matcher.enabled,false);
  const res=await matcher.suggest(base);
  assert.equal(res.configured,false);
  assert.equal(res.tmdbRequests,0);
  assert.equal(res.automaticSave,false);
  assert.equal(res.candidates.length,0);
 }
 assert.equal(requests,0);
});
test('licensed lookup uses fixed TMDB API endpoint and never saves',async()=>{
 let count=0,lastUrl,lastRequest;let clock=10000;
 const fetchImpl=async(url,options)=>{
  count++;lastUrl=new URL(url);lastRequest=options;
  return {ok:true,headers:{get:()=>null},json:async()=>({results:[
   {id:23,name:'Neon Voyage',first_air_date:'2025-04-03',
    overview:'A fictional story',poster_path:'/Visible123.jpg',
    genre_ids:[18]}
  ]})};
 };
 const m=createMetadataMatcher({token:'secret_'.repeat(8),
  commercialLicenseConfirmed:true,fetchImpl,now:()=>clock});
 const first=await m.suggest(base);
 assert.equal(first.ok,true);
 assert.equal(first.candidates[0].title,'Neon Voyage');
 assert.equal(first.candidates[0].genre,'drama');
 assert.equal(first.candidates[0].posterPath,'/Visible123.jpg');
 assert.equal(first.automaticSave,false);
 assert.equal(first.requiresOwnerReview,true);
 assert.equal(first.tmdbRequests,1);
 assert.equal(lastUrl.hostname,'api.themoviedb.org');
 assert.equal(lastUrl.pathname,'/3/search/tv');
 assert.equal(lastUrl.searchParams.get('query'),'Neon Voyage');
 assert.equal(lastUrl.searchParams.get('first_air_date_year'),'2025');
 assert.equal(lastUrl.searchParams.get('include_adult'),'false');
 assert.equal(lastRequest.redirect,'error');
 assert.equal(lastRequest.method,'GET');
 assert.match(lastRequest.headers.authorization,/^Bearer /);
 const cached=await m.suggest(base);
 assert.equal(cached.cacheHit,true);
 assert.equal(cached.tmdbRequests,0);
 assert.equal(count,1);
 const throttled=await m.suggest({...base,query:'Other Title'});
 assert.equal(throttled.code,'tmdb_owner_search_rate_limited');
 assert.equal(count,1);
 clock+=2000;
 const next=await m.suggest({...base,query:'Other Title'});
 assert.equal(next.ok,true);
 assert.equal(count,2);
});
test('private matching HTTP endpoint checks auth, registered key, confirmation',async()=>{
 const token='a'.repeat(48);
 let rows=0,calls=0;
 const catalogStore={
  hasRegisteredKey:async id=>{rows++;return id===key;},
  episodeTitleHints:async()=>['Neon Voyage S01E01','Neon Voyage S01E02']
 };
 const metadataMatcher={enabled:true,suggest:async()=>{
  calls++;return {ok:true,configured:true,tmdbRequests:0,
   candidates:[{title:'Neon Voyage',posterPath:'/ValidPoster123.jpg'}]};
 }};
 const hub=createContentHubServer({token,catalogStore,metadataMatcher,
  storage:{},lease:{}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/library/matches';
 const body=JSON.stringify(base);
 const headers={authorization:'Bearer '+token,
  'content-type':'application/json','x-blofy-owner-action':'match-private-metadata'};
 try{
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   'content-type':'application/json'}})).status,401);
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   authorization:'Bearer '+token,'content-type':'application/json'}})).status,403);
  assert.equal((await fetch(url+'?unsafe=1',{method:'POST',body,headers})).status,403);
  assert.equal((await fetch(url,{method:'POST',body:'{bad',headers})).status,400);
  assert.equal(rows,0);
  assert.equal((await fetch(url,{method:'POST',
   body:JSON.stringify({...base,key:'series:111222333'}),headers})).status,404);
  assert.equal(calls,0);
  const good=await fetch(url,{method:'POST',body,headers});
  assert.equal(good.status,200);
  const result=await good.json();
  assert.equal(result.ok,true);
  assert.equal(result.readOnly,true);
  assert.equal(result.automaticSave,false);
  assert.equal(result.tmdbEnabled,true);
  assert.equal(result.candidates.length,1);
  assert.equal(result.localHints[0].verifiedTitle,false);
  assert.equal(result.providerMediaRequests,0);
  assert.equal(calls,1);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

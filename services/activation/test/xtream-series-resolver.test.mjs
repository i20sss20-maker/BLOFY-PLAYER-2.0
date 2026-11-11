import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSourceEpisodes, mapSeriesEpisodes, normalizePlayableSeriesInfo } from '../src/xtream-series-resolver.mjs';
const sanitize = episode => ({...episode, direct_source:''});

test('unique source episode IDs across seasons retain trusted extensions',()=>{
 const r=collectSourceEpisodes({'1':[{id:'55',container_extension:'mkv'},{id:'56',container_extension:'mp4'}], '2':[{id:'55',container_extension:'mp4'},null]});
 assert.deepEqual(r,[{sourceId:'55',extension:'mkv'},{sourceId:'56',extension:'mp4'}]);
});
test('missing or invalid mappings never leak raw source episode IDs',()=>{
 const r=mapSeriesEpisodes({'1':[{id:'900',title:'Mapped',direct_source:'secret'},{id:'901',title:'Missing'},{id:'902',title:'Invalid'}]},new Map([['900',{id:1200,extension:'mkv'}],['902',{id:0,extension:'mp4'}]]),sanitize);
 assert.deepEqual(r['1'],[{id:1200,title:'Mapped',stream_id:1200,episode_id:1200,episode_num:1,season:1,season_number:1,container_extension:'mkv',direct_source:''}]);
});
test('preserves season keys and safe empty seasons',()=>{
 const r=mapSeriesEpisodes({'0':[],'2':[{id:'1'}]},new Map(),sanitize);
 assert.deepEqual(r,{'0':[],'2':[]});
});
test('invalid provider objects and episode IDs are skipped',()=>{
 assert.deepEqual(collectSourceEpisodes({'1':[{id:null},{id:'a/b'},{id:'22',container_extension:'EXE'}]}),[{sourceId:'22',extension:'mp4'}]);
 assert.deepEqual(mapSeriesEpisodes(null,new Map(),sanitize),{});
});
test('source season entries are immutable',()=>{
 const episode={id:7,container_extension:'mp4',direct_source:'private'};
 const input={'1':[episode]};
 const result=mapSeriesEpisodes(input,new Map([['7',{id:100,extension:'mp4'}]]),sanitize);
 assert.equal(episode.id,7);assert.equal(episode.direct_source,'private');assert.equal(result['1'][0].id,100);
});

test('rejects nonprimitive source IDs without calling their toString',()=>{
 const malicious={toString(){throw new Error('should never call toString')}};
 assert.deepEqual(collectSourceEpisodes({'1':[{id:malicious},{id:12}]}),[{sourceId:'12',extension:'mp4'}]);
});
test('provider cannot inject prototype keys as seasons',()=>{
 const episodes=JSON.parse('{"__proto__":[{"id":"3"}],"1":[{"id":"4"}]}');
 const result=mapSeriesEpisodes(episodes,new Map([['3',{id:99,extension:'mp4'}],['4',{id:100,extension:'mkv'}]]),sanitize);
 assert.equal(Object.getPrototypeOf(result),Object.prototype);
 assert.equal(Object.hasOwn(result,'__proto__'),false);
 assert.equal(result['1'][0].id,100);
});
test('never exposes provider episode ID via missing gateway mapping',()=>{
 const raw={id:'123456',title:'No map'};
 const result=mapSeriesEpisodes({'4':[raw]},new Map(),sanitize);
 assert.deepEqual(result,{'4':[]});
});


test('flat provider episode arrays map to season 1 with stable gateway IDs',()=>{
 const raw=[
  {id:55,title:'Pilot',container_extension:'mkv',direct_source:'https://private.invalid/raw'},
  {id:'56',title:'Second',container_extension:'mp4',direct_source:'secret'}
 ];
 assert.deepEqual(collectSourceEpisodes(raw),[
  {sourceId:'55',extension:'mkv'},
  {sourceId:'56',extension:'mp4'}
 ]);
 const mapped=mapSeriesEpisodes(raw,new Map([
  ['55',{id:2001,extension:'mkv'}],['56',{id:2002,extension:'mp4'}]
 ]),sanitize);
 assert.deepEqual(Object.keys(mapped),['1']);
 assert.deepEqual(mapped['1'].map(x=>x.id),[2001,2002]);
 assert.deepEqual(mapped['1'].map(x=>x.direct_source),['','']);
 assert.equal(raw[0].id,55);
 assert.equal(raw[0].direct_source,'https://private.invalid/raw');
});
test('flat list rejects invalid episodes and never leaks unmapped source IDs',()=>{
 const raw=[{id:'../invalid',title:'unsafe'},null,{id:'44',title:'Unmapped'}];
 assert.deepEqual(collectSourceEpisodes(raw),[{sourceId:'44',extension:'mp4'}]);
 assert.deepEqual(mapSeriesEpisodes(raw,new Map(),sanitize),{'1':[]});
});


test('provider episode_id and stream_id variants yield valid gateway episode links',()=>{
 const raw={'1':[{id:0,episode_id:'5441',container_extension:'mkv',direct_source:'secret'},
    {episode_id:'5442',title:'Episode 2',container_extension:'mp4'},
    {id:null,stream_id:5443,container_extension:'mkv'}]};
 assert.deepEqual(collectSourceEpisodes(raw),[
  {sourceId:'5441',extension:'mkv'},
  {sourceId:'5442',extension:'mp4'},
  {sourceId:'5443',extension:'mkv'}
 ]);
 const mapped=mapSeriesEpisodes(raw,new Map([
  ['5441',{id:201001,extension:'mkv'}],
  ['5442',{id:201002,extension:'mp4'}],
  ['5443',{id:201003,extension:'mkv'}]
 ]),sanitize);
 assert.deepEqual(mapped['1'].map(x=>x.id),[201001,201002,201003]);
 assert.equal(mapped['1'][0].direct_source,'');
 assert.equal(raw['1'][0].id,0);
});
test('nested season arrays and flat season numbers remain playable',()=>{
 const nested={'1':{episodes:[{id:'777',container_extension:'mkv'}]},
   '2':{episodes:[{stream_id:'888'}]}};
 const refs=collectSourceEpisodes(nested);
 assert.deepEqual(refs,[{sourceId:'777',extension:'mkv'},{sourceId:'888',extension:'mp4'}]);
 const mapped=mapSeriesEpisodes(nested,new Map([
   ['777',{id:5011,extension:'mkv'}],['888',{id:5012,extension:'mp4'}]
 ]),sanitize);
 assert.equal(mapped['1'][0].id,5011);
 assert.equal(mapped['2'][0].id,5012);
 const flat=mapSeriesEpisodes([
  {id:'900',season:1},{id:'901',season:2}
 ],new Map([['900',{id:7001,extension:'mp4'}],
   ['901',{id:7002,extension:'mkv'}]]),sanitize);
 assert.deepEqual(Object.keys(flat),['1','2']);
});
test('never invents playable media IDs from zero or malformed alternatives',()=>{
 const raw={'1':[{id:0,stream_id:0},{id:null,stream_id:'../../unsafe'},
  {id:'../../unsafe',episode_id:'7/8'}]};
 assert.deepEqual(collectSourceEpisodes(raw),[]);
 assert.deepEqual(mapSeriesEpisodes(raw,new Map(),sanitize),{'1':[]});
});


test('Xtream episodes expose stable nonzero IDs in id, stream_id and episode_id',()=>{
 const raw={'1':[
  {id:'88111',episode_num:'1',season:2,container_extension:'mkv',direct_source:'https://provider.invalid/secret'},
  {id:'88112',episode_num:0,container_extension:'mp4'}
 ]};
 const mapped=mapSeriesEpisodes(raw,new Map([
  ['88111',{id:104001,extension:'mkv'}],
  ['88112',{id:104002,extension:'mp4'}]
 ]),sanitize);
 assert.deepEqual(mapped['1'].map(x=>[x.id,x.stream_id,x.episode_id]),
  [[104001,104001,104001],[104002,104002,104002]]);
 assert.deepEqual(mapped['1'].map(x=>x.episode_num),[1,2]);
 assert.deepEqual(mapped['1'].map(x=>x.season),[1,1]);
 assert.equal(JSON.stringify(mapped).includes('88111'),false);
 assert.equal(JSON.stringify(mapped).includes('provider.invalid'),false);
 assert.equal(raw['1'][0].season,2,'upstream input must never mutate');
});
test('series info does not advertise metadata-only placeholder seasons',()=>{
 const raw={seasons:[
  {id:2321,season_number:1,episode_count:30,name:'Season One'},
  {id:9912,season_number:2,episode_count:25,name:'Season Two'}
 ],info:{series_id:'321',category_id:'11',name:'Example'}};
 const episodes={'1':[{id:1001},{id:1002}],'2':[]};
 const result=normalizePlayableSeriesInfo(raw,episodes,50042,'8899');
 assert.deepEqual(result.seasons,[
  {id:1,season_number:1,episode_count:2,name:'Season One'}
 ]);
 assert.equal(result.info.series_id,50042);
 assert.equal(result.info.category_id,'8899');
 assert.deepEqual(result.episodes,episodes);
 assert.equal(raw.seasons[0].id,2321);
 assert.equal(raw.info.series_id,'321');
});
test('missing upstream season metadata is reconstructed only for mapped episode groups',()=>{
 const info=normalizePlayableSeriesInfo({info:{name:'Some Show'}},{
  '1':[{id:60001}], '3':[{id:70001},{id:70002}],
  '2':[]},25001);
 assert.deepEqual(info.seasons.map(x=>[x.season_number,x.episode_count]),[[1,1],[3,2]]);
 assert.equal(info.info.series_id,25001);
 assert.equal(normalizePlayableSeriesInfo(null,{},5),null);
});
test('series with no genuine episodes never shows phantom seasons',()=>{
 const result=normalizePlayableSeriesInfo({
  info:{name:'Unknown'},seasons:[{id:1,season_number:1,episode_count:24}]
 },{},35001);
 assert.deepEqual(result.seasons,[]);
 assert.deepEqual(result.episodes,{});
});

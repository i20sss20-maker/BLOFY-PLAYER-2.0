import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSourceEpisodes, mapSeriesEpisodes } from '../src/xtream-series-resolver.mjs';
const sanitize = episode => ({...episode, direct_source:''});

test('unique source episode IDs across seasons retain trusted extensions',()=>{
 const r=collectSourceEpisodes({'1':[{id:'55',container_extension:'mkv'},{id:'56',container_extension:'mp4'}], '2':[{id:'55',container_extension:'mp4'},null]});
 assert.deepEqual(r,[{sourceId:'55',extension:'mkv'},{sourceId:'56',extension:'mp4'}]);
});
test('missing or invalid mappings never leak raw source episode IDs',()=>{
 const r=mapSeriesEpisodes({'1':[{id:'900',title:'Mapped',direct_source:'secret'},{id:'901',title:'Missing'},{id:'902',title:'Invalid'}]},new Map([['900',{id:1200,extension:'mkv'}],['902',{id:0,extension:'mp4'}]]),sanitize);
 assert.deepEqual(r['1'],[{id:1200,title:'Mapped',container_extension:'mkv',direct_source:''}]);
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

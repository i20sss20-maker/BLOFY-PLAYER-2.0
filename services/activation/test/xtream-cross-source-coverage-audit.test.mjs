import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSameMovieCandidates} from '../src/xtream-cross-source-coverage-audit.mjs';
import {readFile} from 'node:fs/promises';

test('same TMDB / IMDB with consistent year is candidate, not verified media',()=>{
 const result=summarizeSameMovieCandidates(
  {name:'Film X',metadata:{tmdb:'234',imdb:'tt123456',year:'2020',
    sourceUrl:'https://secrets.example/token'}},
  [{name:'Film X',metadata:{tmdb:'234',year:'2020',direct_source:'secret'}},
   {name:'Film X',metadata:{imdb:'tt123456',year:'2023'}},
   {name:'Other',metadata:{tmdb:'999',year:'2020'}}]);
 assert.deepEqual(result,{candidateCount:3,sameTitleCount:2,
  matchingExternalIdCount:1,yearConflictCount:1,
  actualMediaVerified:false,automaticFailoverEnabled:false});
 assert.doesNotMatch(JSON.stringify(result),/Film X|https|secret|tt123456|234/);
});
test('same title only is never treated as authenticated movie match',()=>{
 const result=summarizeSameMovieCandidates(
  {name:'Example Movie',metadata:{}},
  [{name:'Example Movie',metadata:{}}]);
 assert.equal(result.sameTitleCount,1);
 assert.equal(result.matchingExternalIdCount,0);
 assert.equal(result.actualMediaVerified,false);
});
test('malformed candidate arrays and external IDs fail closed',()=>{
 const result=summarizeSameMovieCandidates(
  {name:'Test',metadata:{imdb:'untrusted',tmdb:'../secret'}},
  [{name:'Test',metadata:{imdb:'untrusted',tmdb:'../secret'}}]);
 assert.equal(result.matchingExternalIdCount,0);
 assert.equal(summarizeSameMovieCandidates(null,null).candidateCount,0);
});
test('operator-only sample never changes account permissions or streams',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const first=c.indexOf("if(process.env.BLOFY_XTREAM_CROSS_SOURCE_COVERAGE_ON_BOOT==='1')");
 const end=c.indexOf('// Full local audit scans every imported item',first);
 assert.ok(first>0&&end>first);
 const body=c.slice(first,end);
 assert.match(body,/summarizeSameMovieCandidates/);
 assert.match(body,/BLOFY_XTREAM_CROSS_SOURCE_COVERAGE/);
 assert.match(body,/SELECT name,metadata/);
 assert.match(body,/COUNT\(\*\) FILTER \(WHERE source_id IS NULL\)/);
 assert.doesNotMatch(body,/\b(?:UPDATE|INSERT|DELETE|TRUNCATE)\b|issueStreamRelayGrant|proxyMedia\(|syncServer\(/);
 assert.doesNotMatch(body,/console\.info\([^\n]*\.name|JSON\.stringify\(originals\)|JSON\.stringify\(candidates\)/);
});

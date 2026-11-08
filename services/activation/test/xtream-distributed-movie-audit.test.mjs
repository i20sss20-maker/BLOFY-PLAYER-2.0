import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {distributedMovieOffsets,summarizeDistributedMovieProbe}
 from '../src/xtream-distributed-movie-audit.mjs';

test('distributed offsets cover start, middle and end without out-of-bounds',()=>{
 assert.deepEqual(distributedMovieOffsets(24000),[3999,11998,19996]);
 assert.deepEqual(distributedMovieOffsets(2),[0]);
 assert.deepEqual(distributedMovieOffsets(0),[]);
 assert.deepEqual(distributedMovieOffsets(-1),[]);
 assert.deepEqual(distributedMovieOffsets(NaN),[]);
 assert.deepEqual(distributedMovieOffsets(24000,{groups:12}),[]);
});
test('diagnostic preserves real 404 classification and hides filenames',()=>{
 const result=summarizeDistributedMovieProbe({checks:[
  {ok:false,httpStatus:502,error:'relay_provider_not_found',
    title:'SECRET MOVIE',sourceUrl:'https://private.example/password'},
  {ok:true,httpStatus:206,error:null,title:'another title'},
  {ok:false,httpStatus:504,error:'timeout'},
  {ok:false,httpStatus:502,error:'other_private_error'}
 ]});
 assert.deepEqual({
  checked:result.checked,mediaSamples:result.mediaSamples,
  missingFiles:result.missingFiles,otherFailures:result.otherFailures
 },{checked:4,mediaSamples:1,missingFiles:1,otherFailures:2});
 assert.equal(result.results[3].error,'other');
 assert.doesNotMatch(JSON.stringify(result),/SECRET|password|private\.example|another title/);
 assert.equal(result.subscriberPlaybackVerified,false);
});
test('diagnostic only runs for opted-in source and keeps normal checks unchanged',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf("if(process.env.BLOFY_XTREAM_DISTRIBUTED_MOVIE_AUDIT_ON_BOOT==='1')");
 const end=c.indexOf('// END BLOFY DISTRIBUTED MOVIE AUDIT',start);
 assert.ok(start>0&&end>start);
 const audit=c.slice(start,end);
 assert.match(audit,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(audit,/probeXtreamPlayback\(id,'movie',\{\s*sampleOffset:offset,probeAllCandidates:true\s*\}\)/);
 assert.match(audit,/summarizeDistributedMovieProbe/);
 assert.match(audit,/BLOFY_XTREAM_DISTRIBUTED_MOVIE_AUDIT/);
 assert.match(audit,/sourceMutation:false,subscriberCutover:false/);
 assert.doesNotMatch(audit,/\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\b|console\.log\(candidates\)/);
 const pstart=c.indexOf('async function probeXtreamPlayback(');
 const pend=c.indexOf('async function fetchAccount(',pstart);
 const probe=c.slice(pstart,pend);
 assert.match(probe,/ORDER BY name ASC LIMIT 4 OFFSET \$3/);
 assert.match(probe,/if\(!probeAllCandidates\)\{/);
 assert.match(probe,/if\(ok\)break outer/);
 assert.match(probe,/if\(checks\.some\(check=>check\.ok\)\)break/);
});

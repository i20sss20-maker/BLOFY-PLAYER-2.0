import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {distributedMovieOffsets} from '../src/xtream-distributed-movie-audit.mjs';

test('three series offsets are spaced within source catalog',()=>{
 const v=distributedMovieOffsets(5218,{groups:3,perGroup:1});
 assert.equal(v.length,3);
 assert.ok(v[0]>=0&&v[0]<v[1]&&v[1]<v[2]&&v[2]<5218);
});
test('episode audit runs only for opted-in source and does not modify playback',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const first=code.indexOf("if(process.env.BLOFY_XTREAM_DISTRIBUTED_EPISODE_AUDIT_ON_BOOT==='1')");
 const last=code.indexOf('// END BLOFY DISTRIBUTED EPISODE AUDIT',first);
 assert.ok(first>0&&last>first);
 const part=code.slice(first,last);
 assert.match(part,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(part,/media_type='series' AND enabled=TRUE/);
 assert.match(part,/probeXtreamPlayback\(id,'episode',\{\s*sampleOffset:offset,probeAllCandidates:true/);
 assert.match(part,/BLOFY_XTREAM_DISTRIBUTED_EPISODE_AUDIT/);
 assert.match(part,/sourceMutation:false,subscriberCutover:false,credentialsLogged:false/);
 assert.doesNotMatch(part,/\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\b|proxyMedia\(|console\.log\(creds/);
});
test('normal episode UI still probes first series and stops on success',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const begin=code.indexOf('async function probeXtreamSeries(');
 const end=code.indexOf('async function persistSourceMediaProbe(',begin);
 const part=code.slice(begin,end);
 assert.ok(begin>0&&end>begin);
 assert.match(part,/ORDER BY name ASC LIMIT \$2 OFFSET \$3/);
 assert.match(part,/probeAllCandidates\?1:2/);
 assert.match(part,/probeAllCandidates\?2:3/);
 assert.match(part,/if\(!probeAllCandidates&&playback\.ok\)break/);
 assert.match(part,/if\(!probeAllCandidates&&checks\.at\(-1\)\?\.ok\)break/);
 const wrapper=code.slice(code.indexOf('async function probeXtreamPlayback('),
   code.indexOf('async function fetchAccount(',code.indexOf('async function probeXtreamPlayback(')));
 assert.match(wrapper,/probeXtreamSeries\(id,mediaType,\{sampleOffset,probeAllCandidates\}\)/);
});

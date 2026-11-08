import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('optional second-source episode diagnostic is disabled by default and source scoped',async()=>{
 const body=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const begin=body.indexOf("if(process.env.BLOFY_XTREAM_ADDITIONAL_EPISODE_PROBE_ON_BOOT==='1')");
 const end=body.indexOf('// Read-only, source-authorized real transport probe from the NEW STREAM',begin);
 assert.ok(begin>0&&end>begin);
 const part=body.slice(begin,end);
 assert.match(part,/const id=String\(process\.env\.BLOFY_XTREAM_ADDITIONAL_EPISODE_SOURCE_ID/);
 assert.match(part,/if\(!validUuid\(id\)\)return/);
 assert.match(part,/if\(!row\?\.enabled\)return/);
 assert.match(part,/probeXtreamPlayback\(id,'episode'\)/);
 assert.match(part,/BLOFY_XTREAM_ADDITIONAL_EPISODE_PROOF/);
 assert.match(part,/checks\.map\(x=>safeErrors\.has/);
 assert.doesNotMatch(part,/console\.(?:info|warn)\([^\n]*\.title|JSON\.stringify\(checks\)|creds\.|sourceUrl|direct_source/);
 assert.doesNotMatch(part,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/);
});
test('diagnostic reports only statuses, elapsed times and vetted error names',async()=>{
 const body=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=body.indexOf("if(process.env.BLOFY_XTREAM_ADDITIONAL_EPISODE_PROBE_ON_BOOT==='1')");
 const end=body.indexOf('// Read-only, source-authorized real transport probe from the NEW STREAM',start);
 const part=body.slice(start,end);
 for(const key of ['checked:checks.length','successful:checks.filter','failures:checks.filter','statuses:checks.map','errors:checks.map','latenciesMs:checks.map','sourceMutation:false','subscriberCutover:false','customerCredentialsLogged:false'])
  assert.ok(part.includes(key),key);
 assert.doesNotMatch(part, /title:|episodeId:|user:|pass:|url:/);
});

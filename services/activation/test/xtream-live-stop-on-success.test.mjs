import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('source live probe does not test HLS after a successful TS media sample',async()=>{
 const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const begin=source.indexOf('async function probeXtreamPlayback(');
 const end=source.indexOf('async function fetchAccount(',begin);
 const probe=source.slice(begin,end);
 assert.ok(begin>=0&&end>begin);
 // Both TS and HLS are tested when needed, but only until the first
 // successful media byte. This avoids a false "partial" on TS-only CDN.
 assert.match(probe,/xtreamAllowedLiveFormats\(source\.account_info\)/);
 assert.match(probe,/if\(shouldStopXtreamFormatComparison\(httpStatus\)\)break outer;/);
 assert.match(probe,/if\(ok\)break outer;/);
 assert.doesNotMatch(probe,/if\(ok&&!livePolicy\)break outer;/);
 // All provider failures still enter the record before changing format.
 assert.ok(probe.indexOf('checks.push({')<probe.indexOf('if(ok)break outer;'));
 assert.match(probe,/if\(checks\.some\(check=>check\.ok\)\)break;/);
});

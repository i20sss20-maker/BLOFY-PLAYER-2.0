import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('duplicate audit only compares existing rows inside the same enabled source',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf("if(process.env.BLOFY_XTREAM_SAME_SOURCE_DUPLICATES_ON_BOOT==='1')");
 const b=c.indexOf('// END BLOFY SAME SOURCE DUPLICATES AUDIT',a);
 assert.ok(a>0&&b>a);
 const part=c.slice(a,b);
 assert.match(part,/if\(!validUuid\(id\)\)return/);
 assert.match(part,/if\(!source\?\.enabled\|\|!source\.publish_catalog\)return/);
 assert.match(part,/AND source_id<>\$2/);
 assert.match(part,/metadata->>'tmdb'/);
 assert.match(part,/metadata->>'imdb'/);
 assert.match(part,/summarizeSameMovieCandidates\(item,candidates\)/);
 assert.match(part,/BLOFY_XTREAM_SAME_SOURCE_DUPLICATES/);
 assert.match(part,/playableAlternativeVerified:false/);
 assert.match(part,/mediaRequests:0,sourceMutation:false/);
 assert.match(part,/customerRerouting:false,subscriberPermissionsChanged:false/);
 assert.doesNotMatch(part,/\b(?:UPDATE|INSERT|DELETE|TRUNCATE)\b|issueStreamRelayGrant|proxyMedia\(|syncServer\(/);
 assert.doesNotMatch(part,/JSON\.stringify\(candidates\)|JSON\.stringify\(originals\)|credentials\.password|console\.log\(item/);
});

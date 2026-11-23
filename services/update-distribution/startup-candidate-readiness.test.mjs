import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('optional non-public STREAM candidate import cannot delay Railway listener readiness',async()=>{
 const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
 const listen=server.lastIndexOf("server.listen(PORT, '0.0.0.0', () => {");
 assert.ok(listen>0);
 const critical=server.lastIndexOf('await importReleaseArtifactIfConfigured({\n  url: STREAM_ARTIFACT_ZIP_URL');
 const optional=server.lastIndexOf('void importReleaseArtifactIfConfigured({\n    url: STREAM_NEXT_ARTIFACT_ZIP_URL');
 assert.ok(critical>0 && critical<listen,'current public STREAM artifact stays validated before readiness');
 assert.ok(optional>listen,'optional NEXT ZIP runs after readiness');
 assert.match(server.slice(optional,optional+500),/sha256: STREAM_NEXT_ARTIFACT_SHA256/);
 assert.match(server.slice(optional,optional+500),/\.catch\(error =>/);
 assert.ok(!server.slice(critical,listen).includes('STREAM_NEXT_ARTIFACT_ZIP_URL'),
  'candidate network fetch must not block the old signed release feed');
});

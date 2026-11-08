import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamProbeMessage} from '../src/xtream-series-probe.mjs';
import {summarizeSourceMediaProbe,sourceMediaSummary} from '../src/xtream-source-media-health.mjs';

const now=Date.parse('2026-11-08T17:15:00Z');
test('relay outer 502 with verified provider 404 is attributed to provider',()=>{
 const message=xtreamProbeMessage({ok:false,checks:[{
   ok:false,httpStatus:502,error:'relay_provider_not_found'
 }]},'movie');
 assert.match(message,/HTTP 404 من المزود/);
 assert.doesNotMatch(message,/HTTP 502|خلل مؤقت/);
 assert.match(message,/قد يكون غير متاح أو مقيّدًا/);
});
test('ordinary non-provider 502 remains a relay/source failure, not a fabricated provider 404',()=>{
 const message=xtreamProbeMessage({ok:false,checks:[{
   ok:false,httpStatus:502,error:'relay_transport_connection_reset'
 }]},'episode');
 assert.match(message,/HTTP 502/);
 assert.doesNotMatch(message,/HTTP 404 من المزود/);
});
test('source media snapshot preserves relay 502 and separately records verified upstream 404',()=>{
 const result=summarizeSourceMediaProbe('movie',{ok:false,checks:[{
  ok:false,httpStatus:502,error:'relay_provider_not_found',
  password:'do-not-store',sourceUrl:'https://provider.example/private'
 }]},now);
 assert.equal(result.httpStatus,502);
 assert.equal(result.upstreamStatus,404);
 const display=sourceMediaSummary({movie:result},now);
 assert.equal(display.length,1);
 assert.match(display[0].text,/المزود أعاد 404/);
 assert.doesNotMatch(JSON.stringify(result),/do-not-store|provider\.example/);
});
test('generic relay 502 never receives an unsupported upstream 404 label',()=>{
 const result=summarizeSourceMediaProbe('episode',{ok:false,checks:[{
   ok:false,httpStatus:502,error:'relay_transport_timeout'
 }]},now);
 assert.equal(result.upstreamStatus,undefined);
 assert.match(sourceMediaSummary({episode:result},now)[0].text,/502/);
});
test('batch UI names verified provider 404 and never tells operator to debug BLOFY 502',async()=>{
 const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
 assert.match(ui,/const confirmedMissing=reason==='relay_provider_not_found'&&http===502/);
 assert.match(ui,/const status=code==='relay_provider_not_found'&&http===502/);
 assert.match(ui,/confirmedMissing\?'المزود HTTP 404 · '/);
 const first=ui.slice(ui.indexOf('function appendXtreamFailedSampleDetails('),ui.indexOf('// Operator-initiated batch probes:'));
 assert.doesNotMatch(first,/sourceUrl|password|innerHTML/);
});

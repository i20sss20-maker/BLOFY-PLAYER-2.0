import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamAllowedLiveFormats,shouldStopXtreamFormatComparison,outputFormatDescription}
  from '../src/xtream-live-output-policy.mjs';
import {summarizeSourceMediaProbe} from '../src/xtream-source-media-health.mjs';
import {xtreamProbeMessage} from '../src/xtream-series-probe.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('compare only formats explicitly advertised by an Xtream account',()=>{
  assert.deepEqual(xtreamAllowedLiveFormats({allowedOutputFormats:['ts','m3u8']}),
    {formats:['ts','m3u8'],declared:true});
  assert.deepEqual(xtreamAllowedLiveFormats({allowedOutputFormats:['HLS']}),
    {formats:['m3u8'],declared:true});
  assert.deepEqual(xtreamAllowedLiveFormats({allowedOutputFormats:['mpegts','hls']}),
    {formats:['ts','m3u8'],declared:true});
  assert.deepEqual(xtreamAllowedLiveFormats({allowedOutputFormats:['mp4']}),
    {formats:[],declared:true});
  assert.deepEqual(xtreamAllowedLiveFormats({allowedOutputFormats:[]}),
    {formats:['ts'],declared:false});
  assert.deepEqual(xtreamAllowedLiveFormats(null),{formats:['ts'],declared:false});
  assert.match(outputFormatDescription({declared:true,formats:[]}),/لا يعلن/);
  assert.match(xtreamProbeMessage({ok:false,reason:'output_format_not_allowed'},'live'),/TS أو M3U8/);
});

test('explicit provider denials or rate limiting stop format comparisons',()=>{
  for(const status of [401,403,429,456])
    assert.equal(shouldStopXtreamFormatComparison(status),true,String(status));
  for(const status of [0,200,206,404,416,500])
    assert.equal(shouldStopXtreamFormatComparison(status),false,String(status));
});

test('media health prioritizes provider-denied format over an earlier missing path',()=>{
  const time=Date.parse('2026-11-06T15:00:00Z');
  const result=summarizeSourceMediaProbe('live',{ok:false,checks:[
    {ok:false,httpStatus:404,outputFormat:'ts'},
    {ok:false,httpStatus:456,providerHint:'network_restriction',outputFormat:'m3u8'}
  ]},time);
  assert.equal(result.httpStatus,456);
  assert.equal(result.providerHint,'network_restriction');
  assert.equal(result.status,'provider-rejected');
  assert.doesNotMatch(JSON.stringify(result),/user|pass|url/);
});

test('bounded source probe uses formats from source account not fabricated extensions',async()=>{
  const [source,ui]=await Promise.all([
    read('src/xtream-admin-hook.mjs'),
    read('web/sources-admin.js')
  ]);
  const probe=source.slice(source.indexOf('async function probeXtreamPlayback('),
    source.indexOf('async function fetchAccount(',source.indexOf('async function probeXtreamPlayback(')));
  assert.match(probe,/xtreamAllowedLiveFormats\(source\.account_info\)/);
  assert.match(probe,/liveDeadline=Date\.now\(\)\+11500/);
  assert.match(probe,/shouldStopXtreamFormatComparison\(httpStatus\)/);
  assert.match(probe,/outputFormat:ext/);
  assert.match(probe,/HLS: وصول القائمة لا يؤكد عمل مقاطع الفيديو/);
  assert.match(ui,/kind==='live'/);
  assert.match(ui,/outputFormat/);
});

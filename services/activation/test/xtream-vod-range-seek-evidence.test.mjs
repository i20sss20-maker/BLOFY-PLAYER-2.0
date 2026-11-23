import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifiedSoughtVodFormat,verifiedVodResumePlan,vodResumeContractCode}
 from '../src/xtream-vod-range-resume.mjs';

const good={valid:true,format:'unknown'};
const fields={
 inspection:good,requestRange:'bytes=4096-',status:206,
 containerExtension:'mkv',contentType:'video/x-matroska'
};
const headers=(more={})=>new Headers({
 'content-length':'4096','content-range':'bytes 4096-8191/8192',
 'etag':'"stable-revision-1234"','accept-ranges':'bytes',
 'content-encoding':'identity',...more
});
test('an authorized nonzero MKV seek can identify its format without inspecting offset-zero file magic',()=>{
 const format=verifiedSoughtVodFormat(fields);
 assert.equal(format,'mkv');
 const plan=verifiedVodResumePlan({
  enabled:true,kind:'series',status:206,requestRange:'bytes=4096-',
  format,headers:headers()
 });
 assert.equal(plan?.rangeStart,4096);
 assert.equal(plan?.rangeEnd,8191);
 assert.equal(plan?.fileTotal,8192);
 assert.equal(plan?.etag,'"stable-revision-1234"');
});
test('nonzero MP4 seeks use exact extension plus media MIME; not arbitrary binary or spoofed text',()=>{
 assert.equal(verifiedSoughtVodFormat({
  ...fields,containerExtension:'MP4',contentType:'video/mp4'
 }),'mp4');
 for(const x of [
  {contentType:'application/octet-stream'},
  {contentType:'text/html'},
  {containerExtension:'avi'},
  {status:200},
  {requestRange:'bytes=0-'},
  {requestRange:'bytes=-4096'},
  {requestRange:'bytes=4096-8191,12288-16383'},
  {requestRange:'bytes=4096-abc'},
  {requestRange:'bytes=9999999999999999-'},
  {inspection:{valid:false,format:'unknown'}},
  {inspection:{valid:true,format:'text'}},
  {inspection:{valid:true,format:'hls'}}
 ])assert.notEqual(verifiedSoughtVodFormat({...fields,...x}),'mkv',JSON.stringify(x));
});
test('even a reliable format hint never bypasses ETag, exact byte continuity or identity encoding',()=>{
 const format=verifiedSoughtVodFormat(fields);
 for(const h of [
  headers({'etag':'W/"weak"'}),
  headers({'etag':''}),
  headers({'content-range':'bytes 4097-8191/8192'}),
  headers({'content-length':'4095'}),
  headers({'accept-ranges':'none'}),
  headers({'content-encoding':'gzip'}),
 ]){
  assert.equal(verifiedVodResumePlan({
   enabled:true,kind:'series',status:206,requestRange:'bytes=4096-',
   format,headers:h
  }),null);
 }
});
test('safe reason codes identify missing origin contracts without leaking metadata',()=>{
 const common={kind:'series',method:'GET',status:206,
  requestRange:'bytes=4096-',format:'mkv',headers:headers()};
 assert.equal(vodResumeContractCode(common),'source_contract_verified');
 assert.equal(vodResumeContractCode({...common,headers:headers({'etag':''})}),
  'strong_etag_missing');
 assert.equal(vodResumeContractCode({...common,headers:headers({'accept-ranges':'none'})}),
  'byte_ranges_unadvertised');
 assert.equal(vodResumeContractCode({...common,format:'unknown'}),
  'container_unverified');
 assert.equal(vodResumeContractCode({...common,requestRange:'bytes=abc-'}),
  'seek_range_unverified');
 assert.equal(vodResumeContractCode({...common,headers:headers({'content-range':'bytes 4096-8190/8192'})}),
  'source_range_contract_mismatch');
 assert.equal(vodResumeContractCode({...common,usingIndependentRelay:true}),
  'independent_relay');
 const encoded=JSON.stringify(vodResumeContractCode(common));
 assert.doesNotMatch(encoded,/stable-revision|4096|8192|https|account|password/);
});
test('gateway only feeds strict original helper and keeps feature flags, never unconditionally enables VOD recovery',async()=>{
 const code=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(code,/verifiedSoughtVodFormat\(/);
 assert.match(code,/vodResumeContractCode\(/);
 assert.match(code,/format:resumeFormat,headers:response\.headers/);
 assert.match(code,/BLOFY_XTREAM_VOD_RANGE_RESUME_PRODUCTION==='1'/);
 assert.match(code,/BLOFY_XTREAM_VOD_RANGE_RESUME_ENABLED==='1'/);
 assert.match(code,/vodResumeEvidence=vodPlan\?'resume_enabled':'resume_disabled_by_policy'/);
 assert.match(code,/vodResume:kind==='live'\?null:vodResumeEvidence/);
 const region=code.slice(code.indexOf("console.warn('xtream media relay error'"),
  code.indexOf('// Switch egress ONLY',code.indexOf("console.warn('xtream media relay error'")));
 assert.doesNotMatch(region,/\b(?:etag|password|username|headers|accountId)\b|\.href/);
});

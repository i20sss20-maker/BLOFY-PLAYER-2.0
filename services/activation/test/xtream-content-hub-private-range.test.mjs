import test from 'node:test';
import assert from 'node:assert/strict';
import {
 contentHubBridgeAuth,parseContentHubClientRange,
 validContentHubResponse,approvedContentHubMedia,
 CONTENT_HUB_MAX_RANGE_BYTES
} from '../src/xtream-content-hub-private-range.mjs';
const TOKEN='ContentHubBridgeSecretLongEnough32Chars-123456789';
test('exact private bearer token, never cookie or non-bearer access',()=>{
 assert.equal(contentHubBridgeAuth('Bearer '+TOKEN,TOKEN),true);
 assert.equal(contentHubBridgeAuth('Bearer '+TOKEN+'x',TOKEN),false);
 assert.equal(contentHubBridgeAuth('Basic '+TOKEN,TOKEN),false);
 assert.equal(contentHubBridgeAuth(undefined,TOKEN),false);
 assert.equal(contentHubBridgeAuth('Bearer '+TOKEN,'short'),false);
});
test('bounded 8MiB requests reject off-by-one, suffix and unbounded range',()=>{
 assert.deepEqual(parseContentHubClientRange('bytes=0-4095'),
   {from:0,to:4095,length:4096});
 assert.equal(parseContentHubClientRange(`bytes=0-${CONTENT_HUB_MAX_RANGE_BYTES-1}`).length,
   CONTENT_HUB_MAX_RANGE_BYTES);
 for(const range of ['bytes=0-','bytes=-4095','bytes=0-8388608',
  'bytes=0-4095,5000-6000','bytes=4096-0','bytes=0-99999999999999',
  'bytes=01-4095','bytes=0-4095\r\nHost: evil']){
   assert.equal(parseContentHubClientRange(range),null,range);
 }
});
function response(code,contentRange,len,extra={}){
 return {status:code,headers:new Headers({
  'content-range':contentRange,'content-length':String(len),
  'etag':'"stable-content"','content-type':'application/octet-stream',
  ...extra
 })};
}
test('provider 206 must prove same exact requested range; no redirects or 200',()=>{
 const range={from:4096,to:8191,length:4096};
 const ok=validContentHubResponse(response(206,'bytes 4096-8191/2934023949',4096),range);
 assert.equal(ok.size,2934023949);
 assert.equal(ok.validator,'"stable-content"');
 for(const bad of [
  response(200,'bytes 4096-8191/2934023949',4096),
  response(206,'bytes 4097-8191/2934023949',4096),
  response(206,'bytes 4096-8191/*',4096),
  response(206,'bytes 4096-8191/2934023949',4095),
  response(206,'bytes 4096-8191/2934023949',4096,{etag:'a'.repeat(200)})
 ]){
  assert.equal(validContentHubResponse(bad,range),null);
 }
});
test('single exact active saleh source: no other source or unsafe filename',()=>{
 const row={server_enabled:true,source_name:'saleh',source_name_matches:1,
  source_id:'42',server_id:'9adc6472-5d4e-4359-83e4-0298cc038ae3',
  container_extension:'mkv'};
 assert.equal(approvedContentHubMedia(row),true);
 assert.equal(approvedContentHubMedia({...row,source_name:'other'}),false);
 assert.equal(approvedContentHubMedia({...row,source_name_matches:2}),false);
 assert.equal(approvedContentHubMedia({...row,container_extension:'php'}),false);
 assert.equal(approvedContentHubMedia({...row,source_id:'https://evil.invalid/x'}),false);
 assert.equal(approvedContentHubMedia({...row,server_enabled:false}),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLicensedSeries,inspectLicensedSeriesEpisodes,inspectLicensedPilotSeries}
 from '../src/series-catalog.mjs';
const tok='x'.repeat(48),id=31;
const meta={gatewayId:42,sourceId:'9adc6472-5d4e-4359-83e4-0298cc038ae3',
 mediaId:'episode_42',extension:'mkv',title:'E01',
 sourceName:'saleh',mediaKind:'episode',seriesGatewayId:id,
 seasonNumber:1,episodeNumber:1};
function fake(data,status=200){
 return async(url,opts)=>{
  assert.equal(opts.headers.authorization,'Bearer '+tok);
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');
  assert.ok(url.startsWith('http://blofy-activation-portal.railway.internal:3000/internal/blofy-content-hub/series'));
  return {status,headers:new Headers({'content-type':'application/json'}),
   json:async()=>data};
 }
}
test('licensed series list only accepts private read-only bounded responses',async()=>{
 const result=await inspectLicensedSeries({
  env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:tok},
  fetchImpl:fake({ok:true,readOnly:true,series:[{
   seriesGatewayId:id,title:'Series 31',sourceName:'saleh',mediaKind:'series'}]})});
 assert.equal(result.ok,true);assert.equal(result.series.length,1);
 const unsafe=await inspectLicensedSeries({
  env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:tok},
  fetchImpl:fake({ok:true,readOnly:false,series:[]})});
 assert.equal(unsafe.ok,false);
});
test('series episode mapping retains real season and episode, rejects changed metadata',async()=>{
 const env={BLOFY_CONTENT_HUB_BRIDGE_TOKEN:tok};
 const data={ok:true,readOnly:true,seriesGatewayId:id,title:'Series',
  seasons:[{seasonNumber:1,episodeCount:1,episodes:[meta]}]};
 const result=await inspectLicensedSeriesEpisodes({
  seriesGatewayId:id,env,fetchImpl:fake(data)});
 assert.equal(result.ok,true);
 assert.equal(result.seasons[0].episodes[0].episodeNumber,1);
 assert.equal(result.seasons[0].episodes[0].gatewayId,42);
 assert.equal(result.sourceMediaRequests,undefined);
 const changed=await inspectLicensedSeriesEpisodes({
  seriesGatewayId:id,env,fetchImpl:fake({...data,seasons:[{
   seasonNumber:1,episodeCount:1,episodes:[{...meta,mediaId:'https://bad/'}]
  }]})});
 assert.equal(changed.ok,false);
 assert.equal((await inspectLicensedSeriesEpisodes({
  seriesGatewayId:id,env:{},fetchImpl:fake(data)})).ok,false);
});

test('pilot series lookup is read-only and requires exact mapped numeric IDs',async()=>{
 const result=await inspectLicensedPilotSeries({
  env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:tok},
  fetchImpl:fake({ok:true,readOnly:true,
   seriesGatewayId:31,episodeGatewayId:127434})});
 assert.equal(result.ok,true);
 assert.equal(result.seriesGatewayId,31);
 assert.equal(result.episodeGatewayId,127434);
 const invalid=await inspectLicensedPilotSeries({
  env:{BLOFY_CONTENT_HUB_BRIDGE_TOKEN:tok},
  fetchImpl:fake({ok:true,readOnly:true,
   seriesGatewayId:'not-number',episodeGatewayId:127434})});
 assert.equal(invalid.ok,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shouldUseIndependentSourceMedia} from '../src/xtream-independent-source-media-policy.mjs';
const affected='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const healthy='d2bb0397-1c56-4751-adc9-1a17758022f6';
const cfg={BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_ENABLED:'1',
 BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_SOURCE_IDS:affected,
 BLOFY_STREAM_RELAY_ORIGIN:'https://blofy-stream-api-production.up.railway.app',
 BLOFY_STREAM_RELAY_SHARED_TOKEN:'X'.repeat(50)};
test('new media route cannot switch without operator enablement, source allowlist and bearer',()=>{
 const media={sourceId:affected,kind:'live',extension:'ts'};
 assert.equal(shouldUseIndependentSourceMedia(media,cfg),true);
 assert.equal(shouldUseIndependentSourceMedia(media,{...cfg,BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_ENABLED:'0'}),false);
 assert.equal(shouldUseIndependentSourceMedia(media,{...cfg,BLOFY_XTREAM_INDEPENDENT_MEDIA_PROXY_SOURCE_IDS:''}),false);
 assert.equal(shouldUseIndependentSourceMedia(media,{...cfg,BLOFY_STREAM_RELAY_SHARED_TOKEN:'short'}),false);
 assert.equal(shouldUseIndependentSourceMedia(media,{...cfg,BLOFY_STREAM_RELAY_ORIGIN:'https://evil.example'}),false);
});
test('other source, VOD, series and HLS remain on original paths',()=>{
 for(const media of [
   {sourceId:healthy,kind:'live',extension:'ts'},
   {sourceId:affected,kind:'live',extension:'m3u8'},
   {sourceId:affected,kind:'movie',extension:'mp4'},
   {sourceId:affected,kind:'series',extension:'mp4'},
   {sourceId:affected,kind:'live',extension:''}
 ])assert.equal(shouldUseIndependentSourceMedia(media,cfg),false);
});
test('auth, expiry, subscription source and gateway item checks precede new source relay',async()=>{
 const c=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf('async function proxyMedia('),stop=c.indexOf('async function ',start+1);
 const s=c.slice(start,stop);
 const auth=s.indexOf('const account = await authenticate(');
 const item=s.indexOf('gatewayItemById(');
 const sourceSelect=s.indexOf('shouldUseIndependentSourceMedia(');
 const issue=s.indexOf('mediaFetchTarget=new URL(await issueStreamRelayGrant(',sourceSelect);
 const transmit=s.indexOf('response = await checkedFetch(mediaFetchTarget');
 assert.ok(auth>=0&&item>auth&&sourceSelect>item&&issue>sourceSelect&&transmit>issue);
 assert.match(s,/const upstream = mediaUpstreamUrl\(/);
 assert.match(s,/mediaFetchTarget=new URL\(await issueStreamRelayGrant/);
 assert.match(s,/relay_ticket_unavailable/);
 assert.ok(s.indexOf("res.writeHead(307")>=0&&s.indexOf("res.writeHead(307")<sourceSelect);
});
test('admin TS source checks use same source-gated transport, never all sources',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf('async function probeXtreamPlayback('),stop=c.indexOf('async function fetchAccount(',start);
 const s=c.slice(start,stop);
 assert.match(s,/shouldUseIndependentSourceMedia\(\{/);
 assert.match(s,/sourceId:source.id,kind:mediaType,extension:ext/);
 assert.match(s,/issueStreamRelayGrant\(/);
 assert.match(s,/sourceUrl:target.href,kind:mediaType/);
});

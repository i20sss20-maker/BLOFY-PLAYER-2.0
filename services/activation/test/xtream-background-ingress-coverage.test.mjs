import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
function section(start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'expected gateway section');
 return src.slice(a,b);
}
test('background recovery acquires source hold before relay grant and closes after body cancellation',()=>{
 const s=section('async function probeUnavailableMediaOnSameSource(key)','async function runDueUnavailableMedia');
 assert.match(s,/const ingress=await enterLegacyIngress\(row\.server_id\);\s*if\(!ingress\.ok\)return 'transient';/);
 assert.ok(s.indexOf('await enterLegacyIngress')<s.indexOf('await issueStreamRelayGrant'));
 assert.ok(s.lastIndexOf('await ingress.close()')>s.lastIndexOf('await response?.body?.cancel()'));
});
test('content hub episode probe, transfer and manual diagnostics participate in source fence',()=>{
 for(const [start,end,media] of [
 [' if(episodeProbe){'," if(url.pathname==='/internal/blofy-content-hub/episodes/candidates')",'await probePrivateEpisodeRange'],
 [' const range=parseContentHubClientRange(req.headers.range);','async function probeGatewayMedia','await checkedFetch'],
 ['async function probeGatewayMedia(kind,itemId)','function playerServerInfo','await checkedFetch']
 ]){
  const s=section(start,end),admission=s.indexOf('ingress=await enterLegacyIngress(row.server_id)'),request=s.indexOf(media);
  assert.ok(admission>=0&&request>admission,start);
  assert.match(s,/if\(!ingress\.ok\)return/);
  assert.ok(s.lastIndexOf('await ingress.close()')>request,start);
  assert.match(s,/finally\{try\{if\(ingress\?\.ok\)await ingress\.close\(\)\}finally\{hubActiveRange=false\}\}|try\{if\(ingress\?\.ok\)await ingress\.close\(\)\}finally\{(?:hubActiveRange|itemProbeRunning)=false\}/);
 }
});

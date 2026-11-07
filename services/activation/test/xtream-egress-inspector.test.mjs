import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parsePublicEgressIPv4,observeRailwayEgress,probeXtreamSocket} from '../src/xtream-egress-inspector.mjs';

test('public egress IPv4 validation rejects invalid, private or injected bodies',()=>{
  assert.equal(parsePublicEgressIPv4('208.77.244.242\n'),'208.77.244.242');
  for(const raw of ['127.0.0.1','10.1.1.2','192.168.0.2','203.0.113.1',
    'https://test.invalid', '208.77.244.242;token=secret', '','::1'])
    assert.equal(parsePublicEgressIPv4(raw),null,raw);
});
test('egress check contacts fixed HTTPS services only and collects valid unique IPs',async()=>{
  const requests=[];
  const result=await observeRailwayEgress({fetchImpl:async(url,options)=>{
    requests.push({url,options});
    return {status:200,text:async()=>url.includes('ipify')
      ?'208.77.244.242':url.includes('amazonaws')?'208.77.244.242\n':'152.55.184.240\n'};
  }});
  assert.deepEqual(result,{checked:3,responses:3,observedIps:['208.77.244.242','152.55.184.240']});
  assert.equal(requests.length,3);
  assert.ok(requests.every(req=>req.url.startsWith('https://')&&req.options.redirect==='error'));
});
test('outbound IPv4 probe does not fabricate results on errors',async()=>{
  const result=await observeRailwayEgress({fetchImpl:async()=>{throw new Error('network failed')}});
  assert.deepEqual(result,{checked:3,responses:0,observedIps:[]});
});
test('provider socket reports TLS handshake failures without leaking the hostname',async()=>{
  let dialTarget;
  const result=await probeXtreamSocket('https://licensed.example:8443',{
    checkPublic:async()=>{},
    dial:async(target)=>{dialTarget=target;return {ok:false,stage:'tls',code:'xtream_transport_connection_reset'};}
  });
  assert.equal(dialTarget.protocol,'https:');
  assert.equal(dialTarget.port,'8443');
  assert.deepEqual(result,{ok:false,stage:'tls',code:'xtream_transport_connection_reset'});
  assert.doesNotMatch(JSON.stringify(result),/licensed\.example/);
});
test('private addresses are rejected before any dial attempt',async()=>{
  let called=0;
  const result=await probeXtreamSocket('http://127.0.0.1:8080',{
    dial:async()=>{called++;return {ok:true,stage:'tcp',code:'connected'}}
  });
  assert.equal(called,0);
  assert.equal(result.ok,false);
  assert.equal(result.stage,'dns_or_host');
  assert.equal(result.code,'xtream_private_host_blocked');
});
test('one-shot production code never logs credentials or touches source tables',async()=>{
  const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const start=code.indexOf("if(process.env.BLOFY_XTREAM_EGRESS_ONE_SHOT==='1')");
  const end=code.indexOf('// Opt-in, one-shot production probe:',start);
  assert.ok(start>0&&end>start);
  const segment=code.slice(start,end);
  assert.match(segment,/observeRailwayEgress\(\)/);
  assert.match(segment,/probeXtreamSocket\(row\.base_url\)/);
  assert.match(segment,/fetchAccount\(row,\{timeoutMs:8000,maxAttempts:1\}\)/);
  assert.match(segment,/BLOFY_EGRESS_SOURCE_CHECK/);
  assert.doesNotMatch(segment,/DELETE FROM|UPDATE blofy_|INSERT INTO|syncServer\(|probeXtreamPlayback\(|password_secret|username_secret/);
});

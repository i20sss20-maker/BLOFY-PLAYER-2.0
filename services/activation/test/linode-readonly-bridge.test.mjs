import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {probeLinodeBridge,validateBridgeReport} from '../src/linode-readonly-bridge.mjs';
const report=()=>({product:'BLOFY ENGINE PRO',mode:'monitoring-only',timestamp:new Date().toISOString(),status:'HEALTHY',alert_count:0,live:{healthy:true},timeshift:{healthy:true}});
const config={BLOFY_LINODE_BRIDGE_ENABLED:'true',BLOFY_LINODE_BRIDGE_KEY_B64:Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nmock\n').toString('base64'),BLOFY_LINODE_BRIDGE_HOST_KEY:'ssh-ed25519 AAAA'};
test('disabled by default; no SSH process',async()=>{
 assert.equal(await probeLinodeBridge({},()=>{throw Error('unexpected');}),null);
});
test('report validates freshness, mode and playback checks',()=>{
 assert.equal(validateBridgeReport(report()),true);
 assert.equal(validateBridgeReport({...report(),alert_count:1}),false);
 assert.equal(validateBridgeReport({...report(),live:{healthy:false}}),false);
 assert.throws(()=>validateBridgeReport({...report(),timestamp:'2020-01-01T00:00:00Z'}));
 assert.throws(()=>validateBridgeReport({...report(),mode:'production'}));
});
test('strict host key, fixed command, secret cleanup and no forwarding',async()=>{
 let identity;
 const result=await probeLinodeBridge(config,async(file,args,options)=>{
   assert.equal(file,'/usr/bin/ssh');
   assert.ok(args.includes('StrictHostKeyChecking=yes'));
   assert.ok(args.includes('ClearAllForwardings=yes'));
   assert.deepEqual(args.slice(-2),['blofybridge@172.239.239.142','status']);
   assert.equal(options.timeout,6500);
   assert.equal(options.env.BLOFY_LINODE_BRIDGE_KEY_B64,undefined);
   identity=args[args.indexOf('-i')+1];
   assert.match(await readFile(identity,'utf8'),/^-----BEGIN OPENSSH PRIVATE KEY-----/);
   return {stdout:JSON.stringify(report())};
 });
 assert.equal(result.status,'healthy');
 await assert.rejects(access(identity));
});
test('invalid configuration and transport failures remain contained',async()=>{
 assert.equal((await probeLinodeBridge({BLOFY_LINODE_BRIDGE_ENABLED:'true'})).status,'error');
 assert.equal((await probeLinodeBridge(config,async()=>{throw Error('secret');})).status,'offline');
});

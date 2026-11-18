import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('paused second Xtream source can be inspected without re-enabling its four subscriber accounts',async()=>{
 const hook=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const bridge=hook.indexOf('async function unifiedStreamBridge(req,res,url)');
 const auth=hook.indexOf('streamBridgeAuthorized(req.headers.authorization,STREAM_BRIDGE_KEY)',bridge);
 const start=hook.indexOf("p==='/internal/blofy-stream/ops/disabled-source-connectivity'",auth);
 const finish=hook.indexOf("p==='/internal/blofy-stream/ops/source-stats'",start);
 assert.ok(bridge>0&&auth>bridge&&start>auth&&finish>start);
 const block=hook.slice(start,finish);
 assert.match(block,/body\?\.readOnlyConfirmed!==true/);
 assert.match(block,/source\.enabled!==false/);
 assert.match(block,/d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a/);
 assert.match(block,/fetchAccount\(source,\{timeoutMs:8000,maxAttempts:1\}\)/);
 assert.match(block,/sourceStillDisabled:true/);
 assert.match(block,/subscriptionAccountsUnchanged:true/);
 assert.match(block,/mediaBytesRead:0/);
 assert.doesNotMatch(block,/startSync\(|patchServer\(|UPDATE blofy_xtream_servers|DELETE FROM|proxyMedia\(|get_series_info|fetchUpstreamApi/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Gemini connection test remains bridge authenticated and bounded',async()=>{
 const source=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const bridge=source.indexOf('async function unifiedStreamBridge(req,res,url)');
 const authorized=source.indexOf('streamBridgeAuthorized(req.headers.authorization,STREAM_BRIDGE_KEY)',bridge);
 const endpoint=source.indexOf("p==='/internal/blofy-stream/library-ai/connection-test'",bridge);
 assert.ok(bridge>=0&&authorized>bridge&&endpoint>authorized);
 assert.match(source,/geminiTestTimes\.length>=5/);
 assert.match(source,/gemini_connection_test_cooldown/);
 assert.match(source,/name:'Football Sports'/);
});

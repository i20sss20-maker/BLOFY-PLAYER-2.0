import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const page=new URL('../web/sources-admin.html',import.meta.url);
const script=new URL('../web/stream-live-monitor.js',import.meta.url);
test('Stream home includes an accessible monitoring panel with manual refresh',async()=>{
 const html=await readFile(page,'utf8');
 assert.match(html,/id="blofyLiveMonitor"/);
 assert.match(html,/id="blofyLiveRefresh"/);
 assert.match(html,/id="blofyLiveMonitorRows"/);
 assert.match(html,/stream-live-monitor\.js/);
 assert.match(html,/stream-live-monitor\.css/);
});
test('monitor is read-only and uses existing admin cookie session',async()=>{
 const code=await readFile(script,'utf8');
 assert.match(code,/credentials:'same-origin'/);
 assert.ok(!code.includes('localStorage'));
 assert.ok(!code.includes('sessionStorage'));
 assert.ok(!code.includes('POST'));
 assert.ok(!code.includes('innerHTML'));
 assert.ok(!code.includes('password='));
});

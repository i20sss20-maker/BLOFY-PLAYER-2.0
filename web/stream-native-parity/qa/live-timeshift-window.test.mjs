import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
test('live history is bounded and opt-in',()=>{
 const a=source.indexOf('function liveWindowSegments('),b=source.indexOf('const LIVE_WINDOW_SEGMENTS=',a);
 assert.ok(a>=0&&b>a);
 const limit=new Function(source.slice(a,b)+';return liveWindowSegments')();
 for(const x of [undefined,null,'',0,7,121,60.5,'invalid',Infinity])assert.equal(limit(x),8);
 assert.equal(limit('60'),60);assert.equal(limit(120),120);
 assert.ok(source.includes("'-hls_list_size',String(LIVE_WINDOW_SEGMENTS),'-hls_delete_threshold','24'"));
 assert.ok(source.includes('liveWindowSegments:LIVE_WINDOW_SEGMENTS'));
});

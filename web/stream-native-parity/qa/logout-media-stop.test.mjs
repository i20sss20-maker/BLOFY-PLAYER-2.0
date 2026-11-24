import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app = readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start = app.indexOf('var pendingMediaStops=0;');
const end = app.indexOf('function setStatus(',start);
assert.ok(start >= 0 && end > start, 'media-stop accounting helper exists');
const helper = app.slice(start,end);

function setup() {
 const requests = [];
 class FakeXHR {
  constructor(){this.readyState=0;this.status=0;requests.push(this)}
  open(method,url){this.method=method;this.url=url}
  setRequestHeader(){}
  send(){}
  resolve(status){this.status=status;this.readyState=4;this.onreadystatechange()}
 }
 const context={XMLHttpRequest:FakeXHR,S:{accountEpoch:1},JSON,Math,RegExp};
 vm.runInNewContext(helper,context);
 return {context,requests};
}

test('media STOP remains tracked until server acknowledgement, even on failure',()=>{
 const {context,requests}=setup();
 context.api('POST','/api/hls/live/31/ts/0/stop',{},()=>{});
 assert.equal(context.pendingMediaStops,1);
 requests[0].resolve(502);
 assert.equal(context.pendingMediaStops,0);
});

test('late STOP response after account switch drains without invoking stale callback',()=>{
 const {context,requests}=setup();
 let calls=0;
 context.api('POST','/api/hls/live/31/ts/0/stop',{},()=>calls++);
 assert.equal(context.pendingMediaStops,1);
 context.S.accountEpoch++;
 requests[0].resolve(200);
 assert.equal(context.pendingMediaStops,0);
 assert.equal(calls,0);
});

test('non-media API calls do not block logout and failed STOP connection drains',()=>{
 const {context,requests}=setup();
 context.api('POST','/api/logout',{},()=>{});
 assert.equal(context.pendingMediaStops,0);
 context.api('POST','/api/vod/movie/31/mp4/0/120/stop',{},()=>{});
 assert.equal(context.pendingMediaStops,1);
 requests[1].onerror();
 assert.equal(context.pendingMediaStops,0);
});

test('logout closes active player before invalidating the cookie with bounded wait',()=>{
 const begin=app.indexOf("document.getElementById('logout').onclick=function()");
 const end=app.indexOf('\n}\nfunction fmt(',begin);
 assert.ok(begin>0 && end>begin);
 const logout=app.slice(begin,end);
 assert.ok(logout.indexOf('cleanupPlayer();')>=0);
 assert.ok(logout.indexOf("api('POST','/api/logout'")>logout.indexOf('cleanupPlayer();'));
 assert.match(logout,/pendingMediaStops>0&&Date\.now\(\)<deadline/);
 assert.match(logout,/Date\.now\(\)\+3500/);
});

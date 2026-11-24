import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const begin=app.indexOf('function touchPlayerTapDecision('),end=app.indexOf('function setDeviceInput(',begin);
assert.ok(begin>=0&&end>begin,'tap and fullscreen helpers are present');
const helpers=vm.runInNewContext(app.slice(begin,end)+
 ';({touchPlayerTapDecision,appleTouchBrowser})',{String,Number});

test('touch tap alternates show/hide while keeping paused and dialogs visible',()=>{
 const tap=helpers.touchPlayerTapDecision;
 assert.equal(tap('touch',true,true,false),'reveal');
 assert.equal(tap('touch',true,false,false),'hide');
 assert.equal(tap('touch',true,false,true),'reveal');
 assert.equal(tap('touch',false,false,false),'reveal');
 assert.equal(tap('remote',true,false,false),'reveal');
 assert.equal(tap('mouse',true,false,false),'reveal');
});

test('iPhone native fullscreen fallback also recognizes desktop-UA iPadOS',()=>{
 const apple=helpers.appleTouchBrowser;
 assert.equal(apple('iPhone Safari',0),true);
 assert.equal(apple('iPad Safari',0),true);
 assert.equal(apple('Macintosh Safari',5),true);
 assert.equal(apple('Macintosh Safari',0),false);
 assert.equal(apple('Android Chrome',7),false);
 assert.match(app,/if\(appleTouchBrowser\(navigator\.userAgent,navigator\.maxTouchPoints\)\&\&video\.webkitEnterFullscreen\)/);
});

test('mobile player has accessible native-like quick transport controls',()=>{
 for(const id of ['mobile-player-previous','mobile-player-toggle','mobile-player-next','mobile-player-fullscreen']){
  assert.ok(app.includes('id="'+id+'"'),id);
 }
 assert.match(app,/class="mobile-player-actions"/);
 assert.match(app,/role="toolbar" aria-label="تحكم سريع باللمس"/);
 assert.match(app,/if\(isLive\&\&state\.switchChannel\)state\.switchChannel\(-1\)/);
 assert.match(app,/if\(isLive\&\&state\.switchChannel\)state\.switchChannel\(1\)/);
 assert.match(app,/else if\(previousEpisode\)jumpEpisode\(previousEpisode\)/);
 assert.match(app,/else if\(nextEpisode\)jumpEpisode\(nextEpisode\)/);
 assert.match(app,/else if\(state\.seekBy\)state\.seekBy\(10\)/);
 assert.match(app,/if\(S\.route==='player'\&\&S\.playerView===state\)revealControls\(\)/);
});

test('tap shows and hides controls without touching the video engine or requests',()=>{
 const start=app.indexOf('function touchVideoPointer(');
 const stop=app.indexOf('function refreshVideoResolution(',start);
 assert.ok(start>begin&&stop>start);
 const scoped=app.slice(start,stop);
 assert.match(scoped,/video\.addEventListener\('click'/);
 assert.match(scoped,/root\.classList\.add\('controls-hidden'\)/);
 assert.match(scoped,/if\(action==='hide'\)/);
 assert.match(scoped,/state\.hudTimer\)\{clearTimeout\(state\.hudTimer\)/);
 assert.doesNotMatch(scoped,/\.load\(|\.src=|\.pause\(|\.play\(|fetch\(|\bapi\(/);
 assert.match(app,/getAttribute\('data-blofy-input'\)==='touch'\?6200:3800/);
 assert.match(app,/if\(document\.documentElement\.getAttribute\('data-blofy-input'\)==='touch'\&\&video\.paused\)return/);
});

test('mobile presentation is touch-only and accommodates landscape and safe areas',()=>{
 assert.match(css,/\.mobile-player-actions\{display:none\}/);
 assert.match(css,/html\[data-blofy-device="touch"\] \.mobile-player-actions\{/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/min-height:54px/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/@media\(max-height:440px\) and \(orientation:landscape\)/);
 assert.match(css,/touch-action:manipulation/);
 assert.match(app,/mobileFull\.setAttribute\('aria-pressed',String\(on\)\)/);
});

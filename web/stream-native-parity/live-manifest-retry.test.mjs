import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
const begin=app.indexOf('function resumeLiveHlsNetwork('),end=app.indexOf('function playHls(',begin);
assert.ok(begin>=0&&end>begin);
const resume=new Function(app.slice(begin,end)+';return resumeLiveHlsNetwork')();
test('initial failed manifest reloads the same session URL',()=>{
 const calls=[],engine={loadSource:url=>calls.push(url),startLoad:()=>calls.push('start')};
 resume(engine,'/same-manifest',{});
 assert.deepEqual(calls,['/same-manifest']);
});
test('established HLS session resumes loading without reloading the source',()=>{
 const calls=[],engine={loadSource:url=>calls.push(url),startLoad:()=>calls.push('start')};
 resume(engine,'/same-manifest',{manifestParsed:true});
 assert.deepEqual(calls,['start']);
});

const lostStart=app.indexOf('function liveSessionLost(');
const lostEnd=app.indexOf('function resumeLiveHlsNetwork(',lostStart);
const {liveSessionLost,liveSessionRetryDelay}=new Function(app.slice(lostStart,lostEnd)+';return {liveSessionLost,liveSessionRetryDelay}')();
test('only established fatal missing fragments or unavailable playlists require a new session',()=>{
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:true,frag:{}},404),true);
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:true,details:'levelLoadError'},503),true);
 assert.equal(liveSessionLost({},{fatal:true,frag:{}},404),false);
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:false,frag:{}},404),false);
 assert.equal(liveSessionLost({manifestParsed:true},{fatal:true,details:'fragLoadError'},429),false);
});
test('source restart backoff is bounded and respects a valid Retry-After',()=>{
 assert.equal(liveSessionRetryDelay(0,0),5000);
 assert.equal(liveSessionRetryDelay(2,12),12000);
 assert.equal(liveSessionRetryDelay(4,30),30000);
 assert.equal(liveSessionRetryDelay(4,999),25000);
});

test('full-screen adds a modest bounded buffer reserve while preview remains unchanged',()=>{
 const start=app.indexOf('function liveBufferProfile('),end=app.indexOf('function resumeLiveHlsNetwork(',start);
 const profile=new Function(app.slice(start,end)+';return liveBufferProfile')();
 assert.deepEqual(profile(true),{sync:4,maxLatency:10,buffer:35});
 assert.deepEqual(profile(false),{sync:5,maxLatency:12,buffer:45});
 assert.match(app,/record\.ready\|\|record\.reconnecting\|\|video\.paused/);
 assert.match(app,/!record\.ready\|\|record\.reconnecting\|\|!video\.isConnected/);
});

test('live sequence guard detects a reset without treating duplicate playlists as failures',()=>{
 const start=app.indexOf('function liveSequenceRegressed('),end=app.indexOf('function liveBufferProfile(',start);
 const check=new Function(app.slice(start,end)+';return liveSequenceRegressed')();
 const state={};
 assert.equal(check(state,{startSN:10,endSN:17,live:true}),false);
 assert.equal(check(state,{startSN:11,endSN:18,live:true}),false);
 assert.equal(check(state,{startSN:11,endSN:18,live:true}),false);
 assert.equal(check(state,{startSN:0,endSN:7,live:false}),false);
 assert.equal(check(state,{startSN:0,endSN:7,live:true}),true);
 assert.equal(check(state,{startSN:0,endSN:null,live:true}),false);
 assert.equal(state.highestLiveEndSN,18);
});

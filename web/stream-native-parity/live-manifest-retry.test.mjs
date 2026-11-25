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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('licensed LIVE play does not create a second manifest request just to read video dimensions',()=>{
 const start=app.indexOf('function probeSourceVideoMode(){');
 const end=app.indexOf('function status(text)',start);
 assert.ok(start>0&&end>start,'probe should stay inside LIVE/VOD player');
 const probe=app.slice(start,end);
 const early=probe.indexOf("if(kind==='live')return;");
 const extra=probe.indexOf('fetch(manifest,');
 assert.ok(early>0&&extra>early,'live must skip duplicate probe before any fetch');
 assert.match(app,/video\.videoWidth/);
 assert.match(app,/video\.videoHeight/);
});
test('PWA updates commentary asset alongside app shell without caching protected streams',()=>{
 assert.match(sw,/blofy-stream-shell-v7/);
 assert.match(sw,/['"]\/stream-commentary\.js['"]/);
 assert.match(sw,/url\.origin!==self\.location\.origin/);
 assert.match(sw,/SHELL\.indexOf\(url\.pathname\)<0/);
 assert.doesNotMatch(sw,/SHELL=\[[^\]]*\/api\//);
});

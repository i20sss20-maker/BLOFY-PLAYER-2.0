// Offline prototype only: no customer media, tokens, network or production flags.
// Run: node --test qa/vod-subtitle-single-input.test.mjs (requires FFmpeg).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function ff(args){return spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...args],{encoding:'utf8',timeout:30000,maxBuffer:65536})}
function ok(r){assert.equal(r.status,0,r.stderr||String(r.error||''))}
test('known embedded text subtitle can be emitted alongside HLS using one input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blofy-vtt-'));
 try{
  const input=join(dir,'input.mkv'),srt=join(dir,'fixture.srt'),vtt=join(dir,'chunk.vtt');
  writeFileSync(srt,'1\n00:00:01,000 --> 00:00:03,000\nاختبار الترجمة\n\n2\n00:00:05,000 --> 00:00:07,000\nSecond subtitle\n');
  ok(ff(['-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-i',srt,'-t','8','-map','0:v','-map','1:a','-map','2:s','-c:v','libx264','-preset','ultrafast','-c:a','aac','-c:s','srt',input]));
  ok(ff(['-ss','4','-i',input,'-t','4','-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','ultrafast','-c:a','aac','-f','hls','-hls_time','2','-hls_list_size','0',join(dir,'chunk.m3u8'),'-t','4','-map','0:s:0','-c:s','webvtt','-output_ts_offset','4','-f','webvtt',vtt]));
  assert.match(readFileSync(vtt,'utf8'),/^WEBVTT/);
  assert.match(readFileSync(vtt,'utf8'),/Second subtitle/);
  assert.match(readFileSync(join(dir,'chunk.m3u8'),'utf8'),/#EXTINF:/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('optional map is not safe when a subtitle stream is absent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blofy-no-vtt-'));
 try{
  const input=join(dir,'input.mkv');
  ok(ff(['-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-preset','ultrafast','-c:a','aac',input]));
  const result=ff(['-i',input,'-t','2','-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','ultrafast','-c:a','aac','-f','hls',join(dir,'chunk.m3u8'),'-t','2','-map','0:s:0?','-c:s','webvtt','-f','webvtt',join(dir,'chunk.vtt')]);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/does not contain any stream/i);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

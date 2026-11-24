import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

function ffmpeg(args,timeout=45000){
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{encoding:'utf8',timeout});
 assert.equal(r.status,0,(r.stderr||'ffmpeg failed').slice(-1000))
}

test('after 11 minutes, broadcast AAC clock stays at 48 kHz and voices keep their pitch',()=>{
 const output='/tmp/blofy-qa-long-aac.aac',last='/tmp/blofy-qa-last-audio.f32';
 // FFmpeg processes a synthetic 660-second broadcast faster than real time;
 // this test intentionally does not connect to any subscriber/provider.
 ffmpeg([
  '-f','lavfi','-i','sine=frequency=700:sample_rate=44100',
  '-t','660','-af','aresample=async=1:min_hard_comp=0.100:first_pts=0',
  '-c:a','aac','-b:a','160k','-ac','2','-ar','48000',
  '-f','adts','-y',output
 ]);
 ffmpeg(['-ss','650','-i',output,'-t','4','-ac','1','-ar','48000',
  '-f','f32le','-y',last]);
 const raw=readFileSync(last),samples=raw.length/4;
 assert.ok(samples>48000*3,'last seconds of the synthetic 11-minute stream decode');
 let crossings=0,previous=raw.readFloatLE(0);
 for(let i=1;i<samples;i++){
  const x=raw.readFloatLE(i*4);
  if(previous<=0&&x>0)crossings++;
  previous=x
 }
 const frequency=crossings/(samples/48000);
 assert.ok(frequency>690&&frequency<710,
  '11-minute output must keep 700 Hz speech surrogate at original pitch; detected '+frequency.toFixed(1)+' Hz')
});

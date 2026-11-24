import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const web=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('anonymous worker capacity snapshot classifies two active slots and never includes source identities',()=>{
 const start=worker.indexOf('const encoderCapacityWindow='),end=worker.indexOf('\nconst hardTTL=',start);
 assert.ok(start>=0&&end>start);
 let clock=1000;
 const DateStub={now:()=>clock};
 const hlsSessions=new Map();
 const ctx={Date:DateStub,hlsSessions,MAX_JOBS:2,active:2,Math,Number};
 const {encoderCapacitySnapshot:take,noteEncoderCapacityDenied:denied}=vm.runInNewContext(
  worker.slice(start,end)+';({encoderCapacitySnapshot,noteEncoderCapacityDenied})',ctx);
 hlsSessions.set('secret-stream-1',{kind:'live',stopped:false,released:false,sharedAlias:false,bearer:'secret'});
 hlsSessions.set('secret-stream-2',{kind:'movie',fullVod:true,stopped:false,released:false,subscriber:'secret'});
 hlsSessions.set('alias',{kind:'live',sharedAlias:true,released:false,stopped:false});
 hlsSessions.set('ended',{kind:'series',released:true,stopped:false});
 const snapshot=JSON.parse(JSON.stringify(take(clock)));
 assert.deepEqual(snapshot,{activeJobs:2,limit:2,freeSlots:0,busy:true,deniedLastMinute:0,
  jobKinds:{live:1,legacyVod:0,fullVod:1,compatible:0}});
 assert.doesNotMatch(JSON.stringify(snapshot),/secret|bearer|subscriber|alias/);
 denied();denied();
 assert.equal(take(clock).deniedLastMinute,2);
 clock+=60001;
 assert.equal(take(clock).deniedLastMinute,0,'1-minute pressure window auto-resets');
 ctx.active=1;hlsSessions.clear();
 assert.equal(take(clock).jobKinds.compatible,1,'/convert FFmpeg job counted anonymously');
 assert.equal(take(clock).freeSlots,1);
 assert.equal(take(clock).busy,false);
});
test('per-kind 429 rejection paths count only capacity denial, not successful source or session starts',()=>{
 const hls=worker.slice(worker.indexOf('async function startHls('),worker.indexOf('/* Preview-only fan-out'));
 const vod=worker.slice(worker.indexOf('async function startVod('),worker.indexOf('async function vodRequest('));
 const full=worker.slice(worker.indexOf('function fullVodChunk('),worker.indexOf('async function fullVodRequest('));
 assert.match(hls,/if\(active>=MAX_JOBS\)\{noteEncoderCapacityDenied\(\)/);
 assert.match(vod,/if\(active>=MAX_JOBS\)\{noteEncoderCapacityDenied\(\)/);
 assert.match(full,/if\(active>=MAX_JOBS\)\{noteEncoderCapacityDenied\(\)/);
 assert.match(worker,/if\(active>=MAX_JOBS\)\{noteEncoderCapacityDenied\(\);return json\(429,\{error:'compat_capacity'/);
 assert.equal((worker.match(/noteEncoderCapacityDenied\(\);return/g)||[]).length,5);
 assert.match(worker,/encoderCapacity:encoderCapacitySnapshot\(now\)/);
 assert.match(worker,/const MAX_JOBS=2/);
});
test('first-party authenticated API strips upstream account values and caps numeric capacity counters',()=>{
 const start=web.indexOf('function boundedEncoderCount('),end=web.indexOf('\nfunction verifiedWorkerRetryHeaders(',start);
 assert.ok(start>0&&end>start);
 const {safeEncoderCapacity:clean}=vm.runInNewContext(web.slice(start,end)+
  ';({safeEncoderCapacity})',{Number,Math});
 const candidate={
  busy:true,freeSlots:1000,deniedLastMinute:9999999,
  bearer:'Bearer secret-value',accountId:'secret-user',
  jobKinds:{live:100,fullVod:1,legacyVod:-1,compatible:'2',token:'token-secret'}
 };
 const sanitized=JSON.parse(JSON.stringify(clean(candidate)));
 // The Web API now reports up to four slots on the separately deployed
 // capacity-controlled production worker. This sanitizer test is independent
 // of the local two-slot synthetic media-worker source fixture above.
 assert.deepEqual(sanitized,{busy:true,freeSlots:4,deniedLastMinute:100000,
  jobKinds:{live:4,legacyVod:0,fullVod:1,compatible:2}});
 assert.doesNotMatch(JSON.stringify(sanitized),/secret|token|Bearer/);
 assert.equal((web.match(/encoderCapacity:safeEncoderCapacity\(/g)||[]).length,2,
  'media-health and compatible-health require identical sanitization');
 assert.match(web,/if\(!h\)return json\(401,\{error:'activation_required'\}\)/);
});
test('read-only busy status must not trip Railway health checks; customer UI clearly calls data instantaneous',()=>{
 const start=worker.indexOf("if(path==='/health'"),end=worker.indexOf("if(path.startsWith('/hls/'))",start);
 const health=worker.slice(start,end);
 assert.match(health,/const ok=status&&SECRET\.length===64&&!!hlsCheck\?\.ok&&!!vodSeekCheck\?\.ok/);
 assert.doesNotMatch(health,/busy.*503|active>=MAX_JOBS.*503/);
 assert.match(app,/محركات الفيديو النشطة/);
 assert.match(app,/محاولات تشغيل مؤجلة للسعة خلال الدقيقة الأخيرة/);
 assert.match(app,/BLOFY STREAM Web 1\.0 • الإصدار الرسمي/);
 assert.doesNotMatch(app,/نسخة مطابقة قيد التطوير/);
});

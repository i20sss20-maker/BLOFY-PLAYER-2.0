import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
for(const [name,code] of [['startHls','hls_storage_unavailable'],['startVod','vod_storage_unavailable']]){
 test(name+' refuses failed storage before acquiring capacity',async()=>{
 const start=source.indexOf('async function '+name+'(');
 const end=source.indexOf('const session=',start);
 assert.ok(start>=0&&end>start);
 const prefix=source.slice(start,end);
 assert.ok(prefix.indexOf('mkdirSync(dir')<prefix.indexOf('active++'));
 assert.ok(prefix.includes("error:'"+code+"',status:503"));
 assert.ok(prefix.includes("randomBytes(6).toString('hex')"));
 const fn=new Function('mkdirSync','hlsRoot','join','randomBytes','MAX_JOBS','hlsSessions','noteEncoderCapacityDenied',`let active=0; ${prefix} }; return async ()=>({result:await ${name}({key:'x',kind:'live'}),active});`)(
 ()=>{throw Error('ENOSPC')},'/tmp',(...s)=>s.join('/'),()=>({toString:()=> 'unique'}),2,new Map(),()=>{});
 const result=await fn();
 assert.deepEqual(result,{result:{error:code,status:503},active:0});
 });
}

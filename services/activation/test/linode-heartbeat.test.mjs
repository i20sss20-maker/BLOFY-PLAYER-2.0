import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {authorizedHeartbeat,sanitizeHeartbeat,configureLinodeHeartbeat,receiveLinodeHeartbeat,probeLinodeHeartbeat} from '../src/linode-heartbeat.mjs';
const token='a'.repeat(64);
const digest=createHash('sha256').update(token).digest('hex');
const env={BLOFY_LINODE_HEARTBEAT_ENABLED:'true',BLOFY_LINODE_HEARTBEAT_SHA256:digest};
const sample=()=>({product:'BLOFY ENGINE PRO',mode:'monitoring-only',timestamp:new Date().toISOString(),status:'HEALTHY',alert_count:0,live:{healthy:true,secret:'discard'},timeshift:{healthy:true},catalog_total:293007,resources:{memory_available_GiB:6,disk_free_GiB:130},secret:'discard'});
test('heartbeat token digest authentication and projection',()=>{
 assert.equal(authorizedHeartbeat('Bearer '+token,digest),true);
 assert.equal(authorizedHeartbeat('Bearer '+'b'.repeat(64),digest),false);
 assert.equal(authorizedHeartbeat('Bearer '+digest,digest),false);
 const p=sanitizeHeartbeat(sample());
 assert.equal(p.secret,undefined);assert.equal(p.live.secret,undefined);
 assert.throws(()=>sanitizeHeartbeat({...sample(),timestamp:'2020-01-01T00:00:00Z'}));
 assert.throws(()=>sanitizeHeartbeat({...sample(),mode:'production'}));
});
test('heartbeat write is authenticated, bounded, parameterized and monotonic; stale report is offline',async()=>{
 let saved;let calls=0;
 configureLinodeHeartbeat({query:async(sql,params)=>{
   calls++;if(params){assert.match(sql,/ON CONFLICT/);assert.match(sql,/observed_at<EXCLUDED.observed_at/);saved=JSON.parse(params[1]);return {rows:[]};}
   assert.match(sql,/120 seconds/);return {rows:saved?[{report:saved}]:[]};
 }});
 const url=new URL('https://api.blofyplayer.com/api/v1/internal/linode-heartbeat');
 const request=(auth,body=JSON.stringify(sample()))=>Object.assign(Readable.from([Buffer.from(body)]),{method:'POST',headers:{authorization:auth,'content-length':String(Buffer.byteLength(body)),'content-type':'application/json'}});
 let status;
 const json=(_res,code)=>{status=code;};
 await receiveLinodeHeartbeat(request('Bearer invalid'),{},url,json,env);assert.equal(status,401);assert.equal(calls,0);
 await receiveLinodeHeartbeat(request('Bearer '+token,'x'.repeat(4097)),{},url,json,env);assert.equal(status,400);assert.equal(calls,0);
 await receiveLinodeHeartbeat(request('Bearer '+token),{},url,json,env);assert.equal(status,200);
 assert.equal((await probeLinodeHeartbeat(env)).status,'healthy');
 saved=null;assert.equal((await probeLinodeHeartbeat(env)).status,'offline');
 assert.equal(await probeLinodeHeartbeat({}),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {sanitizeHostbrrWorkerHeartbeat,configureHostbrrWorkerHeartbeat,receiveHostbrrWorkerHeartbeat} from '../src/hostbrr-worker-heartbeat.mjs';
const report=()=>({engineId:'hostbrr',mode:'monitoring-only',customerTrafficEnabled:false,timestamp:new Date().toISOString(),workerStatus:'inactive',deliveryHealthy:true,gatewayHealthy:true,memoryAvailableMiB:1024,diskFreeMiB:2048});
test('monitoring strips untrusted capacity and source data',()=>{
 const p=sanitizeHostbrrWorkerHeartbeat({...report(),capacity:{authoritative:true},password:'secret'});
 assert.equal(p.capacity,undefined);assert.equal(p.password,undefined);
 for(const patch of [{engineId:'linode'},{customerTrafficEnabled:true},{timestamp:'2000-01-01'},{workerStatus:'arbitrary'}])
  assert.throws(()=>sanitizeHostbrrWorkerHeartbeat({...report(),...patch}));
});
test('only authenticated POST stores a sanitized bounded report',async()=>{
 const token='a'.repeat(64);
 const env={BLOFY_HOSTBRR_HEARTBEAT_ENABLED:'true',BLOFY_HOSTBRR_HEARTBEAT_SHA256:createHash('sha256').update(token).digest('hex')};
 const calls=[];configureHostbrrWorkerHeartbeat({query:async(...a)=>calls.push(a)});
 const url=new URL('https://example.org/api/v1/internal/hostbrr-worker-heartbeat');
 async function send(header,settings=env,p=report()){
  const b=Buffer.from(JSON.stringify(p));const req=Readable.from([b]);req.method='POST';req.headers={authorization:header,'content-length':b.length,'content-type':'application/json'};
  let status;await receiveHostbrrWorkerHeartbeat(req,{},url,(_,s)=>status=s,settings);return status;
 }
 assert.equal(await send('Bearer '+token,{}),404);
 assert.equal(await send('Bearer '+'b'.repeat(64)),401);
 assert.equal(await send('Bearer '+token,env,{...report(),customerTrafficEnabled:true}),400);
 assert.equal(calls.length,0);
 assert.equal(await send('Bearer '+token,env,{...report(),secret:'not persisted'}),200);
 assert.equal(calls.length,1);assert.ok(calls[0][0].includes('observed_at<EXCLUDED.observed_at'));
 assert.equal(JSON.parse(calls[0][1][1]).secret,undefined);
});

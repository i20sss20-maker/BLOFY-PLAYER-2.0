import {test} from 'bun:test';
import assert from 'node:assert/strict';
test('actual Bun edge HTTP path preserves TS bytes, status, range and auth rejection',async()=>{
 let requests=0;
 const data=new Uint8Array(188*64);for(let i=0;i<data.length;i++)data[i]=i%251;
 const origin=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  requests++;
  const path=new URL(req.url).pathname;
  if(path.includes('/denied/'))return new Response('denied',{status:401});
  if(req.headers.get('range')==='bytes=0-187')return new Response(data.slice(0,188),{status:206,headers:{'Content-Type':'video/mp2t','Content-Range':'bytes 0-187/'+data.length}});
  if(path.endsWith('/2.ts')){
   let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=data.length){controller.close();return}controller.enqueue(data.slice(offset,offset+188*8));offset+=188*8}}),{headers:{'Content-Type':'video/mp2t'}});
  }
  return new Response(data,{headers:{'Content-Type':'video/mp2t','Content-Length':String(data.length)}});
 }});
 const previousOrigin=Bun.env.EDGE_FIXTURE_ORIGIN,previousPort=Bun.env.PORT;
 Bun.env.EDGE_FIXTURE_ORIGIN='http://127.0.0.1:'+origin.port;
 Bun.env.PORT='0';
 let edge;
 try{
  const fixture=await import('./fixtures/xtream-edge-loopback.mjs');
  edge=fixture.server;
  const base='http://127.0.0.1:'+edge.port;
  const res=await fetch(base+'/live/testuser/testpassword/1.ts');
  assert.equal(res.status,200);
  assert.equal(res.headers.get('content-length'),String(data.length));
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()),data);
  assert.equal(fixture.liveBodyCounts.eof,0);
  const live=await fetch(base+'/live/testuser/testpassword/2.ts');
  assert.equal(live.status,200);assert.equal(live.headers.get('content-length'),null);
  assert.deepEqual(new Uint8Array(await live.arrayBuffer()),data);
  assert.equal(fixture.liveBodyCounts.eof,1);
  const range=await fetch(base+'/live/testuser/testpassword/1.ts',{headers:{Range:'bytes=0-187'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 0-187/'+data.length);
  assert.deepEqual(new Uint8Array(await range.arrayBuffer()),data.slice(0,188));
  const denied=await fetch(base+'/live/denied/testpassword/1.ts');
  assert.equal(denied.status,401);await denied.text();
  assert.equal(requests,4,'no duplicate source requests');
 }finally{
  edge?.stop(true);origin.stop(true);
  if(previousOrigin===undefined)delete Bun.env.EDGE_FIXTURE_ORIGIN;else Bun.env.EDGE_FIXTURE_ORIGIN=previousOrigin;
  if(previousPort===undefined)delete Bun.env.PORT;else Bun.env.PORT=previousPort;
 }
});

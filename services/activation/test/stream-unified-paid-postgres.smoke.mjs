import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import http from 'node:http';
import {once} from 'node:events';
import {createStreamDurationCodes,ensureStreamCodeTable,streamCodeProof} from '../src/xtream-duration-codes.mjs';
import {ensureStreamCommercialSchema} from '../src/xtream-code-commercial.mjs';
import {createStreamConnectPairing} from '../src/stream-connect-pairing.mjs';
import {createDatabaseUnifiedRedeemer,handleUnifiedCodeHttp} from '../src/stream-unified-code-redeem.mjs';

const url=new URL(process.env.DATABASE_URL||'postgresql://invalid');
if(process.env.BLOFY_STREAM_EPHEMERAL_DB_QA!=='true'||url.hostname!=='127.0.0.1'||url.pathname!=='/blofy_connect_qa')
 throw Error('ephemeral local QA database required');
const schema='qa_unified_paid_'+crypto.randomBytes(6).toString('hex');
const admin=new pg.Pool({connectionString:url.href,max:1});
await admin.query('CREATE SCHEMA '+schema);
const pool=new pg.Pool({connectionString:url.href,max:8,options:'-c search_path='+schema});
const paidKey=crypto.randomBytes(32).toString('hex'),connectKey=crypto.randomBytes(32).toString('hex');
process.env.BLOFY_STREAM_UNIFIED_LOGIN_QA='1';
process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY=paidKey;
process.env.BLOFY_STREAM_CONNECT_KEY=connectKey;
try{
 await ensureStreamCodeTable(pool);
 await ensureStreamCommercialSchema(pool);
 await pool.query(`CREATE TABLE blofy_xtream_gateway_accounts (
 id UUID PRIMARY KEY,label TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password_proof TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,max_connections INTEGER NOT NULL DEFAULT 1 CHECK(max_connections BETWEEN 1 AND 20),
 expires_at TIMESTAMPTZ,last_used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),source_id UUID,credential_vault TEXT)`);
 let now=Date.now();
 const pairA=createStreamConnectPairing({pool,keyHex:connectKey,enabled:true});
 const pairB=createStreamConnectPairing({pool,keyHex:connectKey,enabled:true});
 await pairA.ensureSchema();
 const paidA=createStreamDurationCodes({pool,keyHex:paidKey,clock:()=>now});
 const paidB=createStreamDurationCodes({pool,keyHex:paidKey,clock:()=>now});
 const adapter=(pairing,paid)=>createDatabaseUnifiedRedeemer({pool,pairing,
 paidProof:code=>streamCodeProof(code,paidKey),
 redeemPaid:(code,origin,deviceKey)=>paid.redeem(code,origin,{deviceKey,appOnly:true})});
 const a=adapter(pairA,paidA),b=adapter(pairB,paidB);
 const origin='https://blofyplayer.com',deviceA=crypto.randomBytes(32).toString('hex'),deviceB=crypto.randomBytes(32).toString('hex');
 const request=(code,deviceKey)=>({code,deviceKey,origin});
 const count=async()=>Number((await pool.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_accounts')).rows[0].n);
 const external=await pairA.issue({host:'https://provider.example.com',username:'synthetic',password:'synthetic-qa',numericCode:true});
 const issued=(await paidA.issue({channel:'app',durationDays:30,quantity:1})).items[0];
 assert.equal(await count(),0);
 const races=await Promise.allSettled([a(request(issued.code,deviceA)),b(request(issued.code,deviceB))]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(races.find(r=>r.status==='rejected').reason.status,409);
 const winner=races[0].status==='fulfilled'?deviceA:deviceB;
 const first=races.find(r=>r.status==='fulfilled').value;
 assert.equal(first.type,'blofy_stream');
 assert.equal(first.tokenType,'Bearer');
 assert.match(first.accessToken,/^v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
 assert.equal(first.credentials,undefined);
 assert.equal(first.account.activatedAt,now);
 assert.equal(first.account.expiresAt,now+30*86400000);
 assert.equal(await count(),1);
 now+=86400000;
 const retry=await b(request(issued.code,winner));
 assert.equal(retry.accessToken,first.accessToken);
 assert.deepEqual(retry.account,first.account);
 assert.equal(retry.recovered,true);
 assert.equal(await count(),1);
 // Exercise the deployed route's actual HTTP handler over loopback, using
 // the same database adapter and real paid account from above.
 let enabled=false,limited=false,resolutions=0;
 const server=http.createServer((req,res)=>handleUnifiedCodeHttp(req,res,new URL(req.url,'http://127.0.0.1'),{
  enabled,rateLimit:()=>({allowed:!limited,retryAfterSeconds:7}),origin:()=>origin,
  resolveRedeemer:async()=>{resolutions++;return b;}
 }));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const endpoint='http://127.0.0.1:'+server.address().port+'/api/v1/stream/app/unified-redeem';
 const post=(data,path='',type='application/json')=>fetch(endpoint+path,{method:'POST',headers:{'content-type':type},body:JSON.stringify(data)});
 try{
  assert.equal((await post(request(issued.code,winner))).status,503);
  enabled=true;
  assert.equal((await fetch(endpoint)).status,400);
  assert.equal((await post(request(issued.code,winner),'?code=invalid')).status,400);
  assert.equal((await post(request(issued.code,winner),'','text/plain')).status,400);
  assert.equal((await post({code:issued.code,deviceKey:'invalid'})).status,400);
  assert.equal((await post({code:'x'.repeat(5000),deviceKey:winner})).status,413);
  assert.equal(resolutions,0);
  const response=await post(request(issued.code,winner));
  assert.equal(response.status,201);
  assert.equal(response.headers.get('cache-control'),'no-store, private');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal((await response.json()).accessToken,first.accessToken);
  const missing=await post(request('987654321',winner));
  assert.equal(missing.status,409);
  assert.deepEqual(await missing.json(),{ok:false,error:'stream_code_unavailable'});
  limited=true;
  const blocked=await post(request(issued.code,winner));
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'7');
  assert.equal(resolutions,2);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 console.log('HTTP activation boundary: disabled gate, invalid bodies, query rejection, real paid redemption and rate limits passed');
 const ext=await a(request(external.code,deviceA));
 assert.equal(ext.type,'external_xtream');
 assert.equal(ext.accessToken,undefined);
 assert.equal(await count(),1);
 await assert.rejects(b(request(external.code,deviceB)),{status:404});
 assert.deepEqual((await b(request(external.code,deviceA))).credentials,ext.credentials);
 now=first.account.expiresAt+1;
 await assert.rejects(a(request(issued.code,winner)),{status:409});
 assert.equal(await count(),1);
 console.log('Actual paid issuance, account creation, app token, cross-instance race, unchanged expiry, external isolation and expiry passed');
}finally{
 await pool.end();
 await admin.query('DROP SCHEMA '+schema+' CASCADE');
 await admin.end();
}

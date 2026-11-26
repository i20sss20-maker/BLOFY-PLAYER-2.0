import {createDatabaseUnifiedRedeemer} from '../src/stream-unified-code-redeem.mjs';
import {conflictsWithConnect,conflictsWithPaid,SHARED_CODE_LOCK_SQL} from '../src/stream-code-namespace.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {createStreamConnectPairing} from '../src/stream-connect-pairing.mjs';
import {createConnectHttp} from '../src/stream-connect-http.mjs';
import {Readable} from 'node:stream';
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid');
if(process.env.BLOFY_STREAM_EPHEMERAL_DB_QA!=='true'||url.hostname!=='127.0.0.1'||url.pathname!=='/blofy_connect_qa')throw Error('ephemeral local QA database required');
const pool=new pg.Pool({connectionString:url.href,max:8});
const key=crypto.randomBytes(32).toString('hex'),a=createStreamConnectPairing({pool,keyHex:key,enabled:true}),b=createStreamConnectPairing({pool,keyHex:key,enabled:true});
const input={host:'https://provider.example.com:8443',username:'synthetic-test',password:'synthetic-not-a-real-password'};
const api=createConnectHttp({pairing:a,enabled:true});
async function call(operation,body,bridgeAuthorized=false){
 const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{method:'POST',url:'/qa',headers:{'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
 let result;const res={writeHead(status,headers){result={status,headers}},end(value){result.body=JSON.parse(value)}};
 await api.handle(req,res,{operation,bridgeAuthorized});return result;
}
try{
 await Promise.all([a.ensureSchema(),b.ensureSchema()]);
 assert.equal((await call('issue',input)).status,401);
 const issued=await call('issue',input,true);assert.equal(issued.status,201);
 const code=issued.body.code;assert.match(code,/^BC-[A-Za-z0-9_-]{24}$/);
 const row=(await pool.query('SELECT code_hash,sealed FROM blofy_connect_pairings')).rows[0];
 assert.notEqual(row.code_hash,code);assert.equal(row.sealed.includes(Buffer.from(input.password)),false);
 const outcomes=await Promise.allSettled([a.redeem({code}),b.redeem({code})]);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
 assert.deepEqual(outcomes.find(v=>v.status==='fulfilled').value.credentials,input);
 assert.equal(outcomes.find(v=>v.status==='rejected').reason.status,404);
 const second=await call('issue',input,true);assert.equal(second.status,201);
 const used=await call('redeem',{code:second.body.code});assert.equal(used.status,200);assert.deepEqual(used.body.credentials,input);
 assert.equal((await call('redeem',{code:second.body.code})).status,404);
 const numeric=await call('issue',{...input,numericCode:true},true);assert.equal(numeric.status,201);assert.match(numeric.body.code,/^[0-9]{12}$/);assert.deepEqual((await b.redeem({code:numeric.body.code})).credentials,input);
 const short=await call('issue',{...input,shortCode:true},true);assert.equal(short.status,201);assert.match(short.body.code,/^[0-9]{8}$/);assert.deepEqual((await b.redeem({code:short.body.code})).credentials,input);for(let i=0;i<19;i++)await assert.rejects(a.redeem({code:short.body.code}),/connect_code_expired_or_used/);await assert.rejects(b.redeem({code:short.body.code}),/connect_rate_limited/);
 const expired=await a.issue(input);await pool.query("UPDATE blofy_connect_pairings SET expires_at=NOW()-INTERVAL '1 minute'");
 assert.equal((await call('redeem',{code:expired.code})).status,404);
 assert.equal((await a.purgeExpired()).removed,1);
 assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM blofy_connect_pairings')).rows[0].count,0);
 const bound=await a.issue(input);
 const deviceA=crypto.randomBytes(32).toString('hex'),deviceB=crypto.randomBytes(32).toString('hex');
 const races=await Promise.allSettled([a.redeem({code:bound.code,deviceKey:deviceA}),b.redeem({code:bound.code,deviceKey:deviceB})]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
 const winner=races[0].status==='fulfilled'?deviceA:deviceB;
 assert.deepEqual((await b.redeem({code:bound.code,deviceKey:winner})).credentials,input);
 await assert.rejects(a.redeem({code:bound.code}),/connect_code_expired_or_used/);
 const boundRow=(await pool.query('SELECT claimed_device_hash,expires_at FROM blofy_connect_pairings')).rows[0];
 assert.notEqual(boundRow.claimed_device_hash,winner);assert.equal(new Date(boundRow.expires_at).getTime(),bound.expiresAt);
 await pool.query("UPDATE blofy_connect_pairings SET expires_at=NOW()-INTERVAL '1 minute'");
 await assert.rejects(a.redeem({code:bound.code,deviceKey:winner}),/connect_code_expired_or_used/);
 assert.equal((await a.purgeExpired()).removed,1);
 const corrupt=await a.issue(input);await pool.query("UPDATE blofy_connect_pairings SET sealed=set_byte(sealed,30,(get_byte(sealed,30)+1)%256)");
 const bad=await call('redeem',{code:corrupt.code});assert.equal(bad.status,503);assert.equal(bad.body.code,'connect_pairing_unavailable');
 assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM blofy_connect_pairings')).rows[0].count,0);
 // Exercise both HMAC domains against real isolated PostgreSQL tables.
 await pool.query('CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_duration_codes (code_hash TEXT PRIMARY KEY)');
 const paidKey=crypto.randomBytes(32).toString('hex');
 const external=await a.issue({...input,numericCode:true});
 const paidProof=crypto.createHmac('sha256',Buffer.from(paidKey,'hex')).update('blofy-stream-subscription:v1:').update(external.code).digest('hex');
 const tx=await pool.connect();
 try{
  await tx.query('BEGIN');
  await tx.query(SHARED_CODE_LOCK_SQL);
  assert.equal(await conflictsWithConnect(tx,external.code,{enabled:true,keyHex:key}),true);
  assert.equal(await conflictsWithPaid(tx,external.code,{enabled:true,keyHex:paidKey}),false);
  await tx.query('INSERT INTO blofy_xtream_gateway_duration_codes(code_hash) VALUES($1)',[paidProof]);
  assert.equal(await conflictsWithPaid(tx,external.code,{enabled:true,keyHex:paidKey}),true);
  await tx.query('ROLLBACK');
 }finally{tx.release()}
 const paidHash=code=>crypto.createHmac('sha256',Buffer.from(paidKey,'hex')).update('blofy-stream-subscription:v1:').update(code).digest('hex');
 const paidCode='123456789';
 await pool.query('INSERT INTO blofy_xtream_gateway_duration_codes(code_hash) VALUES($1)',[paidHash(paidCode)]);
 let paidCalls=0;
 const adapter=pairing=>createDatabaseUnifiedRedeemer({pool,pairing,paidProof:paidHash,
  redeemPaid:async(code,origin,deviceKey)=>{
   paidCalls++;assert.equal(code,paidCode);assert.equal(deviceKey,deviceA);
   return {ok:true,accessToken:'fixture',tokenType:'Bearer',account:{activatedAt:100,expiresAt:200}};
  }});
 const dispatchA=adapter(a),dispatchB=adapter(b);
 const request=(code,deviceKey=deviceA)=>({code,deviceKey,origin:'https://blofyplayer.com'});
 const paid=await dispatchA(request(paidCode));assert.equal(paid.type,'blofy_stream');assert.equal(paidCalls,1);
 // A deliberately inserted historical collision must reject both claims.
 await pool.query('INSERT INTO blofy_xtream_gateway_duration_codes(code_hash) VALUES($1)',[paidHash(external.code)]);
 await assert.rejects(dispatchA(request(external.code)),{status:409});
 assert.equal(paidCalls,1);
 await pool.query('DELETE FROM blofy_xtream_gateway_duration_codes WHERE code_hash=$1',[paidHash(external.code)]);
 const unifiedRace=await Promise.allSettled([dispatchA(request(external.code)),dispatchB(request(external.code,deviceB))]);
 assert.equal(unifiedRace.filter(r=>r.status==='fulfilled').length,1);
 const unifiedWinner=unifiedRace[0].status==='fulfilled'?deviceA:deviceB;
 assert.deepEqual((await dispatchB(request(external.code,unifiedWinner))).credentials,input);
 assert.equal(paidCalls,1);
 await assert.rejects(dispatchA(request('987654321')),{status:409});
 await assert.rejects(a.redeem({code:external.code}),{status:404});
 console.log('Unified database dispatch: typed paid fixture, ambiguous code rejection, external device race and recovery passed');
 console.log('CONNECT PostgreSQL: schema race, protected issuance, encrypted storage, atomic redemption, expiry cleanup and tamper detection passed');
}finally{await pool.end()}

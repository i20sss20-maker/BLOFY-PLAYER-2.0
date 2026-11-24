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
 const expired=await a.issue(input);await pool.query("UPDATE blofy_connect_pairings SET expires_at=NOW()-INTERVAL '1 minute'");
 assert.equal((await call('redeem',{code:expired.code})).status,404);
 assert.equal((await a.purgeExpired()).removed,1);
 assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM blofy_connect_pairings')).rows[0].count,0);
 const corrupt=await a.issue(input);await pool.query("UPDATE blofy_connect_pairings SET sealed=set_byte(sealed,30,(get_byte(sealed,30)+1)%256)");
 const bad=await call('redeem',{code:corrupt.code});assert.equal(bad.status,503);assert.equal(bad.body.code,'connect_pairing_unavailable');
 assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM blofy_connect_pairings')).rows[0].count,0);
 console.log('CONNECT PostgreSQL: schema race, protected issuance, encrypted storage, atomic redemption, expiry cleanup and tamper detection passed');
}finally{await pool.end()}

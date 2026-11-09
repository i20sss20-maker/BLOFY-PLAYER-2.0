import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStreamAppToken,parseStreamAppToken,
  verifyStreamAppToken,bearerFromRequest}
  from '../src/xtream-code-app-token.mjs';
import {createStreamDurationCodes} from '../src/xtream-duration-codes.mjs';

const key='a'.repeat(64);
const accountId='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const row={account_id:accountId,code_hash:'b'.repeat(64),
  redeemed_device_hash:'c'.repeat(64)};

test('bearer session is opaque and bound to exact account, code and installation',()=>{
 const token=createStreamAppToken(row,key);
 assert.match(token,/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
 assert.ok(token.length<130);
 assert.equal(parseStreamAppToken(token).accountId,accountId);
 assert.equal(verifyStreamAppToken(token,row,key),true);
 assert.equal(verifyStreamAppToken(token,{...row,redeemed_device_hash:'d'.repeat(64)},key),false);
 assert.equal(verifyStreamAppToken(token,{...row,code_hash:'d'.repeat(64)},key),false);
 assert.equal(verifyStreamAppToken(token,{...row,account_id:'d2bb0397-1c56-4751-adc9-1a17758022f6'},key),false);
 assert.equal(verifyStreamAppToken(token,row,'b'.repeat(64)),false);
 assert.equal(verifyStreamAppToken(token+'.',row,key),false);
 assert.equal(verifyStreamAppToken('junk',row,key),false);
 assert.equal(bearerFromRequest({headers:{authorization:'Bearer '+token}}),token);
 assert.equal(bearerFromRequest({headers:{authorization:token}}),null);
 assert.equal(bearerFromRequest({headers:{authorization:'Bearer '+token+' more'}}),null);
});

test('app-only duration code redemption returns token but no username/pass/m3u',async()=>{
 const values=new Map(), accounts=[];
 const pool={
   async connect(){return {query:pool.query,release(){} }},
   async query(sql,args=[]){
     if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
     if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
     if(sql.includes('COUNT(*)::int AS count FROM blofy_xtream_gateway_duration_codes'))
       return {rows:[{count:values.size}]};
     if(sql.includes('INSERT INTO blofy_xtream_gateway_duration_codes')){
       const [id,code_hash,code_hint,label,source_id,duration_days,max_connections]=args;
       const row={id,code_hash,code_hint,label,source_id,duration_days,max_connections};
       values.set(code_hash,row);return {rows:[row]};
     }
     if(sql.includes('FOR UPDATE'))return {rows:values.has(args[0])?[values.get(args[0])]:[]};
     if(sql.includes('INSERT INTO blofy_xtream_gateway_accounts')){
       accounts.push(args);return {rows:[]};
     }
     if(sql.includes('SET redeemed_at')){
       const row=[...values.values()].find(x=>x.id===args[0]);
       Object.assign(row,{redeemed_at:args[1],expires_at:args[2],account_id:args[3],
         redeemed_device_hash:args[4]});
       return {rows:[row]};
     }
     if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE id=$1'))
       return {rows:accounts.filter(a=>a[0]===args[0]).map(a=>({
         id:a[0],username:a[2],credential_vault:a[7],expires_at:a[5],enabled:true
       }))};
     throw Error('unexpected SQL '+sql.slice(0,60));
   }
 };
 const system=createStreamDurationCodes({pool,keyHex:key,
  clock:()=>Date.parse('2026-11-09T04:00:00Z')});
 const issued=await system.issue({durationDays:30});
 const data=await system.redeem(issued.items[0].code,'https://blofyplayer.com',{
   deviceKey:'d'.repeat(64),appOnly:true
 });
 assert.equal(data.ok,true);
 assert.match(data.accessToken,/^v1\./);
 assert.equal(data.tokenType,'Bearer');
 assert.equal(data.credentials,undefined);
 assert.equal(data.username,undefined);
 assert.equal(data.password,undefined);
 assert.equal(data.m3uUrl,undefined);
 assert.doesNotMatch(JSON.stringify(data),/username|password|m3u|serverUrl/);
 assert.equal(accounts.length,1);
 const retry=await system.redeem(issued.items[0].code,'https://blofyplayer.com',{
   deviceKey:'d'.repeat(64),appOnly:true
 });
 assert.equal(retry.recovered,true);
 assert.equal(retry.accessToken,data.accessToken);
 assert.equal(retry.account.expiresAt,data.account.expiresAt);
 await assert.rejects(system.redeem(issued.items[0].code,'https://blofyplayer.com',{
   deviceKey:'e'.repeat(64),appOnly:true
 }),/stream_code_unavailable/);
});

test('app bearer authorization routes are separate from Xtream login',async()=>{
 const server=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(server,/api\/v1\/stream\/app\/redeem/);
 assert.match(server,/api\/v1\/stream\/app\/session/);
 assert.match(server,/const tokenMedia=url\.pathname\.match/);
 assert.match(server,/verifyStreamAppToken/);
 assert.match(server,/const account = authorizedAccount\|\|await authenticate/);
});

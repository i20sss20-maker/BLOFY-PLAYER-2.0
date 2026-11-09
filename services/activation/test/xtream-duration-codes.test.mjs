import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamDurationCodes,ensureStreamCodeTable,
 normalizeStreamCode,streamCodeProof,validateStreamCodeBatch,
 streamNumericCodeLength,randomNumericStreamCode}
 from '../src/xtream-duration-codes.mjs';

const keyHex='a'.repeat(64);
const source='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';

test('code format is normalized and only a hashed proof is stored',()=>{
 assert.equal(normalizeStreamCode('ab12-ab12-ab12-ab12-ab12-ab12'),'AB12AB12AB12AB12AB12AB12');
 assert.equal(normalizeStreamCode('1234'),null);
 assert.equal(normalizeStreamCode('۱۲٣٤٥٦٧٨'),'12345678');
 assert.equal(normalizeStreamCode('00012345'),'00012345');
 assert.equal(normalizeStreamCode('1234567'),null);
 assert.equal(normalizeStreamCode('ABCD1234'),null);
 assert.equal(streamCodeProof('1234',keyHex),null);
 const a=streamCodeProof('AB12AB12AB12AB12AB12AB12',keyHex);
 assert.match(a,/^[a-f0-9]{64}$/);
 assert.doesNotMatch(a,/AB12/);
 assert.notEqual(a,streamCodeProof('AB12AB12AB12AB12AB12AB13',keyHex));
});
test('duration and batch sizes are strictly bounded',()=>{
 for(const durationDays of [0,-1,731,1.5,'bad',null]){
  assert.throws(()=>validateStreamCodeBatch({durationDays}),/duration_invalid/);
 }
 for(const quantity of [-1,0,21,1.1]){
  assert.throws(()=>validateStreamCodeBatch({durationDays:30,quantity}),/quantity_invalid/);
 }
 assert.equal(validateStreamCodeBatch({durationDays:365,quantity:5,
   maxConnections:2,sourceId:source}).durationDays,365);
});
function fakeDb(){
 const codes=[],accounts=[],statements=[];
 let clockValue=Date.parse('2026-11-09T02:00:00Z');
 async function query(sql,args=[]){
  statements.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
  if(sql.includes('SELECT pg_advisory_xact_lock'))return {rows:[{}]};
  if(sql.includes('SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_duration_codes'))
   return {rows:[{count:codes.length}]};
  if(sql.includes('FROM blofy_xtream_servers'))
   return {rows:args[0]===source?[{id:source}]:[]};
  if(sql.includes('INSERT INTO blofy_xtream_gateway_duration_codes')){
   const [id,code_hash,code_hint,label,source_id,duration_days,max_connections]=args;
   const row={id,code_hash,code_hint,label,source_id,duration_days,max_connections,
     created_at:new Date(clockValue),redeemed_at:null,expires_at:null,
     revoked_at:null,account_id:null};
   codes.push(row);return {rows:[row]};
  }
  if(sql.includes('FROM blofy_xtream_gateway_duration_codes')&&sql.includes('FOR UPDATE'))
   return {rows:codes.filter(x=>x.code_hash===args[0])};
  if(sql.includes('INSERT INTO blofy_xtream_gateway_accounts')){
   accounts.push(args);return {rows:[]};
  }
  if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE id=$1')){
   return {rows:accounts.filter(a=>a[0]===args[0]).map(a=>({
     id:a[0],username:a[2],credential_vault:a[7],
     enabled:true,expires_at:a[5]
   }))};
  }
  if(sql.includes('UPDATE blofy_xtream_gateway_duration_codes')&&sql.includes('SET redeemed_at')){
   const row=codes.find(x=>x.id===args[0]);Object.assign(row,{
     redeemed_at:args[1],expires_at:args[2],account_id:args[3],redeemed_device_hash:args[4]});
   return {rows:[row]};
  }
  if(sql.includes('SET revoked_at=NOW()')){
   const row=codes.find(x=>x.id===args[0]&&!x.redeemed_at&&!x.revoked_at);
   if(!row)return {rows:[]};row.revoked_at=new Date(clockValue);return {rows:[row]};
  }
  if(sql.includes('ORDER BY created_at DESC LIMIT $1 OFFSET $2'))
   return {rows:codes.slice().reverse().slice(args[1],args[1]+args[0])};
  if(sql.includes('COUNT(*) FILTER'))
   return {rows:[{total:codes.length,unused:codes.filter(x=>!x.redeemed_at&&!x.revoked_at).length,
     redeemed:codes.filter(x=>!!x.redeemed_at).length,
     revoked:codes.filter(x=>!!x.revoked_at).length}]};
  throw Error('unexpected SQL: '+sql);
 }
 const connection={query,release(){}};
 return {codes,accounts,statements,pool:{query,async connect(){return connection}},
  setNow(x){clockValue=x}};
}
test('no subscriber is created on issuance; duration begins only when redeemed',async()=>{
 const state=fakeDb(),t0=Date.parse('2026-11-09T02:00:00Z');
 const system=createStreamDurationCodes({pool:state.pool,keyHex,clock:()=>t0+12*86400000});
 const issued=await system.issue({durationDays:30,quantity:2,sourceId:source,label:'مميز'});
 assert.equal(issued.count,2);
 assert.equal(state.accounts.length,0);
 assert.equal(state.codes[0].expires_at,null);
 assert.equal(state.codes[0].redeemed_at,null);
 assert.match(issued.items[0].code,/^[0-9]{8}$/);
 const listed=await system.list();
 assert.equal(listed.items[0].code,undefined,'plaintext codes never in list');
 assert.equal(listed.items[0].status,'unused');
 const redeemed=await system.redeem(issued.items[0].code,'https://blofyplayer.com');
 assert.equal(state.accounts.length,1);
 assert.equal(redeemed.account.activatedAt,t0+12*86400000);
 assert.equal(redeemed.account.expiresAt,t0+42*86400000);
 assert.equal(state.codes[0].redeemed_at.getTime(),t0+12*86400000);
 assert.equal(state.codes[1].redeemed_at,null);
 assert.match(redeemed.credentials.m3uUrl,/get\.php\?username=/);
 assert.equal(redeemed.credentials.serverUrl,'https://blofyplayer.com');
 await assert.rejects(system.redeem(issued.items[0].code,'https://blofyplayer.com'),
  /stream_code_unavailable/);
 assert.equal(state.accounts.length,1,'cannot create account from used code');
});
test('unredeemed codes can be revoked, already redeemed codes cannot',async()=>{
 const state=fakeDb();
 const system=createStreamDurationCodes({pool:state.pool,keyHex});
 const {items}=await system.issue({durationDays:7});
 assert.equal((await system.revoke(items[0].id)).item.status,'revoked');
 await assert.rejects(system.redeem(items[0].code,'https://blofyplayer.com'),
   /stream_code_unavailable/);
 const second=await system.issue({durationDays:14});
 await system.redeem(second.items[0].code,'https://blofyplayer.com');
 await assert.rejects(system.revoke(second.items[0].id),/stream_code_used_or_missing/);
});
test('issued source must be published and active; no cross-source bypass',async()=>{
 const state=fakeDb(),system=createStreamDurationCodes({pool:state.pool,keyHex});
 await assert.rejects(system.issue({durationDays:30,sourceId:
   'd2bb0397-1c56-4751-adc9-1a17758022f6'}),/stream_code_source_unavailable/);
 assert.equal(state.codes.length,0);
});
test('schema and API code avoid retaining cleartext subscription secrets',async()=>{
 const stub={queries:[],async query(sql){this.queries.push(sql);return {rows:[]}}};
 await ensureStreamCodeTable(stub);
 assert.match(stub.queries[0],/code_hash TEXT NOT NULL UNIQUE/);
 assert.match(stub.queries.join(' '),/redeemed_device_hash TEXT/);
 assert.doesNotMatch(stub.queries.join(' '),/plaintext_password|code_plaintext/);
});

test('numeric code length grows automatically with issued volume',()=>{
 for(const [count,digits] of [[0,8],[99,8],[100,9],[999,9],
   [1000,10],[9999,10],[10000,11],[100000,12],[1000000,12]]){
   assert.equal(streamNumericCodeLength(count),digits);
 }
 for(let digits=8;digits<=12;digits++){
   const code=randomNumericStreamCode(digits);
   assert.match(code,new RegExp('^[0-9]{'+digits+'}$'));
 }
 assert.throws(()=>randomNumericStreamCode(6),/length_invalid/);
});
test('issue batch crosses digit thresholds without breaking redemption',async()=>{
 const state=fakeDb();
 const system=createStreamDurationCodes({pool:state.pool,keyHex});
 // Simulate 99 prior issued codes by inserting rows directly in fixture.
 for(let n=0;n<99;n++)state.codes.push({id:String(n),code_hash:'old'+n,
   code_hint:'xxxx',label:'older',source_id:null,duration_days:30,
   max_connections:1,created_at:new Date(),redeemed_at:null,
   expires_at:null,revoked_at:null,account_id:null});
 const result=await system.issue({durationDays:14,quantity:2});
 assert.match(result.items[0].code,/^[0-9]{8}$/);
 assert.match(result.items[1].code,/^[0-9]{9}$/);
 await system.redeem(result.items[1].code,'https://blofyplayer.com');
 assert.equal(state.accounts.length,1);
});
test('legacy 24-character hexadecimal codes continue to redeem',()=>{
 const old='AB12AB12AB12AB12AB12AB12';
 assert.equal(normalizeStreamCode(old),old);
 assert.match(streamCodeProof(old,keyHex),/^[a-f0-9]{64}$/);
 assert.equal(normalizeStreamCode('000000000000000000000000'), '000000000000000000000000');
});

test('app retry recovers same credentials without extending duration',async()=>{
 const state=fakeDb(),clock=Date.parse('2026-11-09T03:00:00Z');
 const system=createStreamDurationCodes({pool:state.pool,keyHex,clock:()=>clock});
 const {items}=await system.issue({durationDays:7,sourceId:source});
 const code=items[0].code,deviceKey='a'.repeat(64);
 const first=await system.redeem(code,'https://blofyplayer.com',{deviceKey});
 const second=await system.redeem(code,'https://blofyplayer.com',{deviceKey});
 assert.equal(first.recovered,false);
 assert.equal(second.recovered,true);
 assert.deepEqual(second.credentials,first.credentials);
 assert.equal(first.account.activatedAt,second.account.activatedAt);
 assert.equal(first.account.expiresAt,second.account.expiresAt);
 assert.equal(state.accounts.length,1);
 await assert.rejects(
   system.redeem(code,'https://blofyplayer.com',{deviceKey:'b'.repeat(64)}),
   /stream_code_unavailable/);
 await assert.rejects(
   system.redeem(code,'https://blofyplayer.com'),
   /stream_code_unavailable/);
 assert.equal(state.accounts.length,1);
});
test('invalid installation binding cannot consume a subscription code',async()=>{
 const state=fakeDb(),system=createStreamDurationCodes({pool:state.pool,keyHex});
 const {items}=await system.issue({durationDays:1});
 await assert.rejects(
   system.redeem(items[0].code,'https://blofyplayer.com',{deviceKey:'123'}),
   /stream_code_device_invalid/);
 assert.equal(state.accounts.length,0);
 assert.equal(state.codes[0].redeemed_at,null);
});

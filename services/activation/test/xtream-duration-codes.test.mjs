import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamDurationCodes,ensureStreamCodeTable,
 normalizeStreamCode,streamCodeProof,validateStreamCodeBatch}
 from '../src/xtream-duration-codes.mjs';

const keyHex='a'.repeat(64);
const source='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';

test('code format is normalized and only a hashed proof is stored',()=>{
 assert.equal(normalizeStreamCode('ab12-ab12-ab12-ab12-ab12-ab12'),'AB12AB12AB12AB12AB12AB12');
 assert.equal(normalizeStreamCode('1234'),null);
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
  if(sql.includes('UPDATE blofy_xtream_gateway_duration_codes')&&sql.includes('SET redeemed_at')){
   const row=codes.find(x=>x.id===args[0]);Object.assign(row,{
     redeemed_at:args[1],expires_at:args[2],account_id:args[3]});
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
 assert.match(issued.items[0].code,/^[A-F0-9]{24}$/);
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
 assert.doesNotMatch(stub.queries.join(' '),/plaintext_password|code_plaintext/);
});

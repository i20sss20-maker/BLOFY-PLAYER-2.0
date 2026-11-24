import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamConnectPairing,normalizeConnectInput,createConnectExpiryMaintenance} from '../src/stream-connect-pairing.mjs';
const input={host:'https://provider.example.com:8443',username:'synthetic-user',password:'synthetic-secret'};
function fixture(){
 let now=Date.now();const rows=new Map();
 async function query(sql,args=[]){
  if(/^(CREATE|BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory)/.test(sql))return {rows:[]};
  if(sql==='DELETE FROM blofy_connect_pairings WHERE expires_at<=NOW()'){for(const [id,r] of rows)if(r.expiresAt<=now)rows.delete(id);return {rows:[]}}
  if(sql.startsWith('SELECT COUNT'))return {rows:[{count:rows.size}]};
  if(sql.startsWith('INSERT INTO blofy_connect_pairings')){if(rows.has(args[0]))return {rows:[]};rows.set(args[0],{sealed:args[1],expiresAt:args[2].getTime()});return {rows:[{code_hash:args[0]}]}}
  if(sql.startsWith('DELETE FROM blofy_connect_pairings WHERE code_hash=')){const r=rows.get(args[0]);if(!r||r.expiresAt<=now)return {rows:[]};rows.delete(args[0]);return {rows:[r]}}
  throw Error('unexpected test query');
 }
 const pool={query,connect:async()=>({query,release(){}})};
 const service=createStreamConnectPairing({pool,keyHex:'a'.repeat(64),enabled:true,clock:()=>now});
 return {service,rows,pool,advance:ms=>{now+=ms}};
}
test('pairing is fail-closed without explicit enable and independent key',async()=>{
 await assert.rejects(createStreamConnectPairing().issue(input),/connect_disabled/);
 await assert.rejects(createStreamConnectPairing({enabled:true,pool:fixture().pool}).issue(input),/connect_key_unconfigured/);
});
test('validate origin only, reject non-HTTP schemes and local addresses',()=>{
 for(const host of ['ftp://provider.example.com','https://127.0.0.1','https://[::1]','https://localhost','https://router.local','https://name.internal','https://user:pass@provider.example.com','https://provider.example.com/path','https://provider.example.com?x=1','https://provider.example.com#x'])assert.throws(()=>normalizeConnectInput({...input,host}),/connect_host_invalid/);
 assert.deepEqual(normalizeConnectInput(input),input);
 assert.throws(()=>normalizeConnectInput({...input,password:'x\nx'}),/connect_input_invalid/);
});
test('issue encrypted code; consume atomically without plaintext persisted or verification claim',async()=>{
 const f=fixture(),issued=await f.service.issue(input);
 assert.match(issued.code,/^BC-[A-Za-z0-9_-]{24}$/);
 assert.equal(issued.providerVerified,false);assert.equal(issued.oneTime,true);
 const [id,row]=[...f.rows.entries()][0];
 assert.notEqual(id,issued.code);assert.equal(row.sealed.includes(Buffer.from(input.password)),false);
 const results=await Promise.allSettled([f.service.redeem({code:issued.code}),f.service.redeem({code:issued.code})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.deepEqual(results.find(r=>r.status==='fulfilled').value.credentials,input);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/connect_code_expired_or_used/);
 assert.equal(f.rows.size,0);
});
test('expiry and authenticated encryption prevent stale or modified payloads',async()=>{
 const f=fixture(),first=await f.service.issue(input);f.advance(15*60*1000+1);
 await assert.rejects(f.service.redeem({code:first.code}),/connect_code_expired_or_used/);
 const second=await f.service.issue(input);assert.equal(f.rows.size,1);
 const row=[...f.rows.values()][0];row.sealed[30]^=1;
 await assert.rejects(f.service.redeem({code:second.code}),/connect_pairing_unavailable/);
 assert.equal(f.rows.size,0);
});

test('expiry maintenance skips disabled and overlapping ticks and never reports raw errors',async()=>{
 let calls=0,finish;const events=[];
 const pairing={purgeExpired:()=>{calls++;return new Promise(resolve=>{finish=resolve})}};
 const disabled=createConnectExpiryMaintenance({pairing});
 assert.deepEqual(await disabled.tick(),{skipped:true});assert.equal(calls,0);
 const active=createConnectExpiryMaintenance({pairing,enabled:true});
 const first=active.tick();assert.deepEqual(await active.tick(),{skipped:true});assert.equal(calls,1);
 finish({removed:2});assert.deepEqual(await first,{removed:2});
 const failing=createConnectExpiryMaintenance({enabled:true,pairing:{purgeExpired:async()=>{throw Error('synthetic private password')}},onError:code=>events.push(code)});
 assert.deepEqual(await failing.tick(),{failed:true});
 assert.deepEqual(await failing.tick(),{failed:true});
 assert.deepEqual(events,['connect_expiry_cleanup_failed','connect_expiry_cleanup_failed']);
});

test('numeric codes and explicit HTTP consent',async()=>{const f=fixture(),http={...input,host:'http://provider.example.com:8080'};await assert.rejects(f.service.issue(http),/connect_host_invalid/);const a=await f.service.issue({...http,allowHttp:true,numericCode:true});assert.match(a.code,/^[0-9]{12}$/);const b=await f.service.issue({...input,numericCode:true});assert.notEqual(a.code,b.code);assert.deepEqual((await f.service.redeem({code:a.code})).credentials,http);await assert.rejects(f.service.redeem({code:a.code}),/connect_code_expired_or_used/);assert.deepEqual((await f.service.redeem({code:b.code})).credentials,input);});

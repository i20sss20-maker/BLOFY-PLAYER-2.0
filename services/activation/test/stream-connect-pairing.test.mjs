import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamConnectPairing,normalizeConnectCredentials,sealConnectPayload,openConnectPayload} from '../src/stream-connect-pairing.mjs';
const credentials={host:'https://example.com:8443',username:'user',password:'secret-private'};
test('normalize only HTTP(S) origin, block literal addresses and unsafe paths',()=>{
 assert.deepEqual(normalizeConnectCredentials({...credentials,host:'https://EXAMPLE.com:8443/'}),credentials);
 for(const host of ['http://127.0.0.1','http://2130706433','http://[::1]','http://server.local','ftp://example.com','http://user:pw@example.com','https://example.com/path','https://example.com?q=abc'])assert.throws(()=>normalizeConnectCredentials({...credentials,host}),/connect_invalid_host/);
});
test('encrypted payload is authenticated and key is derived from high entropy code',()=>{
 const code='BC1-'+'a'.repeat(32),sealed=sealConnectPayload(credentials,code);
 assert.equal(sealed.includes(credentials.password),false);
 assert.deepEqual(openConnectPayload(sealed,code),credentials);
 assert.throws(()=>openConnectPayload(sealed,'BC1-'+'b'.repeat(32)));
});
function fixture(){
 const records=new Map();let current=0;
 const query=async(sql,args=[])=>{
  if(/CREATE |BEGIN|COMMIT|ROLLBACK|pg_advisory/.test(sql))return {rows:[]};
  if(sql.startsWith('DELETE FROM blofy_connect_pairings WHERE expires_at')){for(const [k,v] of records)if(v.expiry<=current)records.delete(k);return {rows:[]}}
  if(sql.startsWith('SELECT COUNT'))return {rows:[{n:records.size}]};
  if(sql.startsWith('INSERT INTO')){records.set(args[0],{sealed_payload:args[1],expiry:current+900000});return {rows:[]}}
  if(sql.startsWith('DELETE FROM blofy_connect_pairings WHERE code_hash')){const row=records.get(args[0]);if(!row||row.expiry<=current)return {rows:[]};records.delete(args[0]);return {rows:[row]}}
  throw Error('unknown query');
 };
 const pool={query,connect:async()=>({query,release(){}})};
 return {pool,records,advance:ms=>{current+=ms}};
}
test('feature off, consent, expiry, one-time claim and no plaintext in storage',async()=>{
 const f=fixture(),off=createStreamConnectPairing({pool:f.pool});
 await assert.rejects(off.issue({...credentials,authorized:true}),/connect_not_enabled/);
 const p=createStreamConnectPairing({pool:f.pool,enabled:true});
 await assert.rejects(p.issue(credentials),/connect_authorization_required/);
 const issued=await p.issue({...credentials,authorized:true});
 assert.match(issued.code,/^BC1-[A-Za-z0-9_-]{32}$/);assert.equal(issued.providerVerified,false);
 assert.equal(JSON.stringify([...f.records]).includes(issued.code),false);
 assert.equal(JSON.stringify([...f.records]).includes(credentials.password),false);
 const outcomes=await Promise.allSettled([p.claim({code:issued.code}),p.claim({code:issued.code})]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.deepEqual(outcomes.find(x=>x.status==='fulfilled').value.credentials,credentials);
 const expired=await p.issue({...credentials,authorized:true});f.advance(900000);
 await assert.rejects(p.claim({code:expired.code}),/connect_code_missing_or_expired/);
 await p.issue({...credentials,authorized:true});assert.equal(f.records.size,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {conflictsWithConnect,conflictsWithPaid,SHARED_CODE_LOCK_SQL} from '../src/stream-code-namespace.mjs';
const keyHex='a'.repeat(64),code='01234567';
const digest=domain=>crypto.createHmac('sha256',Buffer.from(keyHex,'hex')).update(domain).update(code).digest('hex');
test('disabled guard and disjoint lengths make no database calls',async()=>{
 const db={query:async()=>{throw Error('unexpected query')}};
 assert.equal(await conflictsWithConnect(db,code,{enabled:false}),false);
 assert.equal(await conflictsWithPaid(db,'012345678',{enabled:true}),false);
 assert.equal(await conflictsWithConnect(db,'012345678',{enabled:true}),false);
});
test('collision checks use separate HMAC domains and never send raw codes to SQL',async()=>{
 const calls=[];
 const db={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('to_regclass')?[{relation:'blofy_connect_pairings'}]:[{exists:1}]}}};
 assert.equal(await conflictsWithConnect(db,code,{enabled:true,keyHex}),true);
 assert.equal(await conflictsWithPaid(db,code,{enabled:true,keyHex}),true);
 assert.deepEqual(calls[1].args,[digest('blofy-connect:numeric:v1:')]);
 assert.deepEqual(calls[2].args,[digest('blofy-stream-subscription:v1:')]);
 assert.match(calls[1].sql,/expires_at>NOW\(\)/);
 assert.doesNotMatch(calls[2].sql,/expires_at|revoked_at/);
 assert.equal(SHARED_CODE_LOCK_SQL,'SELECT pg_advisory_xact_lock(718420682)');
});
test('no pairing table yet is safe under the shared issuance lock; database errors fail closed',async()=>{
 const db={query:async()=>({rows:[{relation:null}]})};
 assert.equal(await conflictsWithConnect(db,code,{enabled:true,keyHex}),false);
 await assert.rejects(conflictsWithPaid(db,code,{enabled:true,keyHex:'invalid'}),/namespace_unavailable/);
 await assert.rejects(conflictsWithConnect({query:async()=>{throw Error('database unavailable')}},code,{enabled:true,keyHex}),/database unavailable/);
});

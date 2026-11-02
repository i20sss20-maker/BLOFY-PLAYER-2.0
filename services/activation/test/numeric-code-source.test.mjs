import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedCodeSource } from '../src/code-account-status.mjs';
import { createBlofyCodeHandlers, normalizedBlofyCode } from '../src/blofy-code-handlers.mjs';

test('source choices preserve existing BLOFY host, support STROING 8K, and allow explicit public Xtream URLs', () => {
  assert.equal(selectedCodeSource({source:'blofy'}).host,'http://annkel.com:80');
  assert.equal(selectedCodeSource({source:'strong'}).label,'STROING 8K');
  assert.equal(selectedCodeSource({source:'strong'}, {strongHost:'https://strong.example.com'}).host,'https://strong.example.com');
  assert.equal(selectedCodeSource({source:'custom',host:'https://service.example.net:8888'}).host,'https://service.example.net:8888');
  for(const host of ['http://example.com/login','http://user:secret@example.com','file:///etc/passwd','https://example.com?token=x']){
    assert.throws(()=>selectedCodeSource({source:'custom',host}),/invalid_code_host/);
  }
});

test('numeric 8-digit code issuance is bound to verified provider expiry and chosen host',async()=>{
  let inserted,checks=0; const outcomes=[];
  const handler=createBlofyCodeHandlers({
    pool:{query:async (sql,args)=>{inserted={sql,args};return {rows:[{id:args[0]}]};}},
    secretHex:'ad'.repeat(32), json:(_,status,body)=>outcomes.push({status,body}),
    readJson:async()=>({source:'strong',username:'customer123',password:'providerPass'}),
    requireAdmin:()=>true,authorizedDevice:async()=>({}),
    checkAccount:async details=>{checks++;assert.equal(details.host,'http://annkel.com:80');return {expiresAt:1900000000000,status:'active'};}
  });
  await handler.issue({}, {});
  assert.equal(checks,1);
  assert.equal(outcomes[0].status,201);
  assert.match(outcomes[0].body.code,/^\d{8}$/);
  assert.equal(outcomes[0].body.expiresAt,1900000000000);
  assert.equal(outcomes[0].body.source,'strong');
  assert.ok(inserted.sql.includes('host_enc'));
  assert.ok(inserted.sql.includes('source_label'));
  assert.equal(inserted.args[5],'STROING 8K');
  assert.ok(!inserted.args[3].includes('providerPass'));
  assert.ok(!inserted.args[4].includes('annkel.com'));
  assert.equal(normalizedBlofyCode(outcomes[0].body.code),outcomes[0].body.code);
  assert.equal(normalizedBlofyCode('ABCDEF1234'),'ABCDEF1234'); // legacy stays valid
});

test('code creation does not issue codes if Xtream says expired, invalid or unavailable',async()=>{
  for(const cause of ['code_source_expired','code_source_credentials_invalid','code_source_unavailable']){
    let sqlCalls=0;
    const results=[];
    const h=createBlofyCodeHandlers({
      pool:{query:async()=>{sqlCalls++;return {rows:[]};}},
      secretHex:'ac'.repeat(32),json:(_,status,body)=>results.push({status,body}),
      readJson:async()=>({source:'blofy',username:'subscriber',password:'pass'}),
      requireAdmin:()=>true, authorizedDevice:async()=>null,
      checkAccount:async()=>{throw new Error(cause)}
    });
    await h.issue({}, {});
    assert.equal(sqlCalls,0);
    assert.equal(results[0].body.error,cause);
    assert.ok([422,503].includes(results[0].status));
  }
});

test('existing codes with legacy sealed credentials can still be redeemed', async()=>{
  const result=[];
  const user='customer',pass='password',deviceId='BLOFY-ABC123';
  const {createBlofyCodeCrypto}=await import('../src/blofy-code-handlers.mjs');
  const codec=createBlofyCodeCrypto('ab'.repeat(32));
  let queryCount=0;
  const row={id:'11111111-1111-1111-1111-111111111111',active:true,device_id:null,host_enc:null,
    username_enc:codec.seal(user),password_enc:codec.seal(pass),source_label:null,expires_at:null};
  const client={
    async query(sql,args){
      queryCount++;
      if(sql.includes('SELECT * FROM blofy_code_subscriptions'))return {rows:[row]};
      return {rows:[],rowCount:1};
    },release(){}
  };
  const h=createBlofyCodeHandlers({
    pool:{connect:async()=>client},secretHex:'ab'.repeat(32),
    json:(_,status,body)=>result.push({status,body}),
    readJson:async()=>({code:'ABCDEF1234',deviceId,activationCode:'123456'}),
    requireAdmin:()=>true,authorizedDevice:async()=>({device_id:deviceId}),
    checkAccount:async()=>{throw Error('legacy must not probe provider')}
  });
  await h.redeem({headers:{},socket:{remoteAddress:'192.0.2.1'}},{});
  assert.equal(result[0].status,200);
  assert.equal(result[0].body.baseUrl,'http://annkel.com:80');
  assert.equal(result[0].body.username,user);
  assert.ok(queryCount>=3);
});

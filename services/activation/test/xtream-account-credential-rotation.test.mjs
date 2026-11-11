import test from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayCredentialRotator} from '../src/xtream-account-credential-rotation.mjs';
import {verifyGatewayCredential} from '../src/xtream-gateway-core.mjs';
import {decryptGatewayAccountPassword} from '../src/xtream-account-vault.mjs';

const keyHex='a'.repeat(64);
const id='9b41f51a-18d4-48b8-a301-1e32e779a68b';
function fixture() {
 const expiry=new Date('2027-11-11T11:00:00Z');
 const account={
   id,
   username:'blofy03cd508344',
   password_proof:'previous-proof',
   credential_vault:'old-vault',
   enabled:true,
   expires_at:expiry,
   max_connections:2,
   source_id:'5d14f730-aa57-4c4a-8106-34fb6d16f6ae',
   label:'Existing STREAM customer'
 };
 let updates=0;
 const pool={async query(sql,args) {
   assert.match(sql,/UPDATE blofy_xtream_gateway_accounts/);
   assert.match(sql,/SET username=\$2,password_proof=\$3,credential_vault=\$4/);
   assert.doesNotMatch(sql,/SET\s+expires_at|SET\s+redeemed_at/i);
   updates++;
   assert.equal(args[0],id);
   Object.assign(account,{username:args[1],password_proof:args[2],credential_vault:args[3]});
   return {rowCount:1,rows:[{...account}]};
 }};
 return {account,pool,expiry,get updates(){return updates}};
}

test('long existing Xtream credentials rotate into short alphanumeric pair with no subscription renewal',async()=>{
 const f=fixture();
 const rotator=createGatewayCredentialRotator({pool:f.pool,keyHex,
   generateUsername:()=> 'H7kQ2mRp',generatePassword:()=> 'X5mT8rW2pH6a'});
 const result=await rotator(id,{acknowledgeDisconnect:true});
 assert.equal(result.username.length,8);
 assert.equal(result.password.length,12);
 assert.match(result.username,/^[A-Za-z0-9]{8}$/);
 assert.match(result.password,/^[A-Za-z0-9]{12}$/);
 assert.equal(result.oldCredentialsDisabled,true);
 assert.equal(result.subscriptionUnchanged,true);
 assert.equal(f.account.expires_at,f.expiry);
 assert.equal(f.account.max_connections,2);
 assert.equal(f.account.enabled,true);
 assert.equal(f.account.source_id,'5d14f730-aa57-4c4a-8106-34fb6d16f6ae');
 assert.equal(f.account.id,id);
 assert.equal(f.updates,1);
 assert.equal(verifyGatewayCredential(f.account.password_proof,result.username,result.password,keyHex),true);
 assert.equal(verifyGatewayCredential(f.account.password_proof,'blofy03cd508344',result.password,keyHex),false);
 assert.equal(decryptGatewayAccountPassword(id,f.account.credential_vault,keyHex),result.password);
});

test('merely viewing an M3U account cannot rotate it without explicit admin confirmation',async()=>{
 const f=fixture();
 const rotate=createGatewayCredentialRotator({pool:f.pool,keyHex});
 await assert.rejects(rotate(id),/xtream_gateway_rotation_requires_confirmation/);
 await assert.rejects(rotate(id,{acknowledgeDisconnect:'true'}),
   /xtream_gateway_rotation_requires_confirmation/);
 assert.equal(f.updates,0);
 assert.equal(f.account.username,'blofy03cd508344');
});

test('rotation fails closed on invalid account id or malformed generated secrets',async()=>{
 const f=fixture();
 const rotate=createGatewayCredentialRotator({pool:f.pool,keyHex,
   generateUsername:()=> 'blofy-long-username',generatePassword:()=> '123456789012'});
 await assert.rejects(rotate(id,{acknowledgeDisconnect:true}),
   /xtream_gateway_credential_generation_invalid/);
 await assert.rejects(rotate('not-valid',{acknowledgeDisconnect:true}),
   /xtream_gateway_account_invalid/);
 assert.equal(f.updates,0);
});

test('unique username collision triggers a bounded new draw without touching entitlements',async()=>{
 const f=fixture();
 let attempt=0;
 const pool={async query(sql,args) {
   if(attempt++===0)throw Object.assign(Error('unique constraint'),{code:'23505'});
   return f.pool.query(sql,args);
 }};
 const rotate=createGatewayCredentialRotator({pool,keyHex,
   generateUsername:()=>attempt?'Y5kD7nQp':'H7kQ2mRp',
   generatePassword:()=> 'X5mT8rW2pH6a'});
 const result=await rotate(id,{acknowledgeDisconnect:true});
 assert.equal(result.username,'Y5kD7nQp');
 assert.equal(f.updates,1);
 assert.equal(f.account.expires_at,f.expiry);
});

test('unknown account returns 404 and no substitute account is created',async()=>{
 const pool={async query(){return {rowCount:0,rows:[]}}};
 const rotate=createGatewayCredentialRotator({pool,keyHex,
  generateUsername:()=> 'H7kQ2mRp',generatePassword:()=> 'X5mT8rW2pH6a'});
 await assert.rejects(rotate(id,{acknowledgeDisconnect:true}),
   /xtream_gateway_account_not_found/);
});

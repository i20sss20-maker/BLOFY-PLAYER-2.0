import test from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayCredentialChanger} from '../src/xtream-account-credential-change.mjs';
import {verifyGatewayCredential,gatewayCredentialProof} from '../src/xtream-gateway-core.mjs';
import {encryptGatewayAccountPassword,decryptGatewayAccountPassword}
 from '../src/xtream-account-vault.mjs';

const keyHex='a'.repeat(64);
const id='49272f67-4b63-4983-8479-317425718eb3';
const otherId='8c2b47c4-faa1-4d30-9dd1-528d573d246c';
const updatedAt=new Date('2026-11-21T09:00:00Z');
const expiration=new Date('2027-11-21T09:00:00Z');
function fixture(){
 const accounts=new Map();
 for(const [accountId,username,password] of [
  [id,'existing_client','OldPassword99'],[otherId,'already_taken','AnotherPass99']
 ]){
  accounts.set(accountId,{
   id:accountId,label:'Current client',username,
   password_proof:gatewayCredentialProof(username,password,keyHex),
   credential_vault:encryptGatewayAccountPassword(accountId,password,keyHex),
   updated_at:new Date(updatedAt),expires_at:expiration,enabled:true,
   source_id:'b12dcf11-a0b5-4f02-8d44-d4cc9cd3c512',max_connections:2
  });
 }
 const events=[],queries=[];
 let tx=0,updates=0;
 const pool={
  async connect(){
   let snapshot=null;
   return {
    async query(sql,params=[]){
     queries.push({sql,params});
     if(sql==='BEGIN'){tx++;snapshot=structuredClone([...accounts.entries()]);return {};}
     if(sql==='ROLLBACK'){if(snapshot)for(const [k,row] of snapshot)accounts.set(k,row);return {};}
     if(sql==='COMMIT')return {};
     if(sql.includes('FOR UPDATE')){
      const row=accounts.get(params[0]);return {rows:row?[{...row}]:[]};
     }
     if(sql.includes('UPDATE blofy_xtream_gateway_accounts')){
      updates++;
      assert.doesNotMatch(sql,/SET\s+(?:expires_at|source_id|max_connections|enabled|redeemed_at)/);
      assert.deepEqual(sql.match(/\$\d/g)?.slice(0,4),['$2','$3','$4','$1']);
      const row=accounts.get(params[0]);
      if(!row)return {rows:[]};
      if([...accounts.values()].some(a=>a.id!==row.id&&a.username===params[1]))
       throw Object.assign(Error('unique'),{code:'23505'});
      Object.assign(row,{username:params[1],password_proof:params[2],
       credential_vault:params[3],updated_at:new Date(Date.now())});
      return {rows:[{...row}]};
     }
     if(sql.startsWith('CREATE TABLE'))return {};
     if(sql.startsWith('INSERT INTO blofy_xtream_gateway_credential_events')){
      events.push(params);return {rows:[]};
     }
     throw Error('unexpected SQL: '+sql);
    },
    release(){}
   };
  }
 };
 return {pool,events,queries,accounts,
  get tx(){return tx;},get updates(){return updates;}};
}
const base={acknowledgeDisconnect:true,expectedUsername:'existing_client',
 expectedUpdatedAt:updatedAt.getTime()};
const changer=f=>createGatewayCredentialChanger({pool:f.pool,keyHex,
 generateUsername:()=> 'AutoUser88',generatePassword:()=> 'SystemPass123'});

test('manual username AND password update atomically on the exact account, preserving entitlements',async()=>{
 const f=fixture(),change=changer(f);
 const result=await change(id,{...base,usernameMode:'manual',username:'MyClient_25',
  passwordMode:'manual',password:'CustomPass_2027'});
 assert.equal(result.accountId,id);
 assert.equal(result.username,'MyClient_25');
 assert.equal(result.password,'CustomPass_2027');
 assert.equal(result.subscriptionUnchanged,true);
 assert.equal(result.oldCredentialsDisabled,true);
 const row=f.accounts.get(id);
 assert.equal(row.username,'MyClient_25');
 assert.equal(row.expires_at,expiration);
 assert.equal(row.max_connections,2);
 assert.equal(row.source_id,'b12dcf11-a0b5-4f02-8d44-d4cc9cd3c512');
 assert.equal(row.enabled,true);
 assert.equal(verifyGatewayCredential(row.password_proof,
   'MyClient_25','CustomPass_2027',keyHex),true);
 assert.equal(verifyGatewayCredential(row.password_proof,
   'existing_client','OldPassword99',keyHex),false);
 assert.equal(decryptGatewayAccountPassword(id,row.credential_vault,keyHex),'CustomPass_2027');
 assert.equal(f.accounts.get(otherId).username,'already_taken');
 assert.equal(f.events.length,1);
 assert.deepEqual(f.events[0].slice(1),[id,'manual','manual']);
 assert.ok(!JSON.stringify(f.events).includes('CustomPass_2027'),'audit must not contain secrets');
});
test('system-generated username and password preserve old duration and all account links',async()=>{
 const f=fixture();
 const result=await changer(f)(id,{...base,usernameMode:'automatic',passwordMode:'automatic'});
 assert.equal(result.username,'AutoUser88');
 assert.equal(result.password,'SystemPass123');
 assert.equal(f.accounts.get(id).expires_at,expiration);
 assert.deepEqual(f.events[0].slice(1),[id,'automatic','automatic']);
});
test('username-only mode retains old password by decrypting vault and regenerates proof',async()=>{
 const f=fixture();
 const result=await changer(f)(id,{...base,usernameMode:'manual',username:'NewUser005',
  passwordMode:'keep'});
 assert.equal(result.password,'OldPassword99');
 assert.equal(verifyGatewayCredential(f.accounts.get(id).password_proof,
  'NewUser005','OldPassword99',keyHex),true);
 assert.deepEqual(f.events[0].slice(1),[id,'manual','keep']);
});
test('password-only mode retains username and revokes prior password',async()=>{
 const f=fixture();
 const result=await changer(f)(id,{...base,usernameMode:'keep',
  passwordMode:'automatic'});
 assert.equal(result.username,'existing_client');
 assert.equal(result.password,'SystemPass123');
 assert.equal(verifyGatewayCredential(f.accounts.get(id).password_proof,
  'existing_client','OldPassword99',keyHex),false);
 assert.deepEqual(f.events[0].slice(1),[id,'keep','automatic']);
});
test('confirmation, options, unsafe manual input and nonexistent accounts reject without writes',async()=>{
 const f=fixture(),change=changer(f);
 for(const payload of [
  {...base,usernameMode:'manual',username:'Bad spaces',
   passwordMode:'automatic'},
  {...base,usernameMode:'keep',passwordMode:'keep'},
  {...base,usernameMode:'automatic',passwordMode:'manual',password:'short'},
  {...base,usernameMode:'automatic',passwordMode:'keep',acknowledgeDisconnect:false},
  {...base,usernameMode:'automatic',username:'not-allowed',passwordMode:'keep'},
  {...base,usernameMode:'automatic',passwordMode:'keep',expectedUpdatedAt:undefined}
 ])await assert.rejects(change(id,payload));
 await assert.rejects(change('not-uuid',{...base,usernameMode:'automatic',passwordMode:'keep'}));
 await assert.rejects(change('0a101e87-cdad-48cc-8e9e-6888dcc1ac17',{
  ...base,usernameMode:'automatic',passwordMode:'automatic'
 }),/xtream_gateway_account_not_found/);
 assert.equal(f.updates,0);
 assert.equal(f.events.length,0);
});
test('stale tab cannot overwrite a newer credential change',async()=>{
 const f=fixture(),change=changer(f);
 await change(id,{...base,usernameMode:'automatic',passwordMode:'automatic'});
 await assert.rejects(change(id,{...base,usernameMode:'automatic',
  passwordMode:'automatic'}),/xtream_gateway_change_account_modified/);
 assert.equal(f.updates,1);
 assert.equal(f.events.length,1);
});
test('manual duplicate username gives 409 without saving changes or secret audit',async()=>{
 const f=fixture(),change=changer(f);
 await assert.rejects(change(id,{...base,usernameMode:'manual',
  username:'already_taken',passwordMode:'automatic'}),
  /xtream_gateway_username_exists/);
 assert.equal(f.accounts.get(id).username,'existing_client');
 assert.equal(f.events.length,0);
});
test('cannot retain a missing old password when renaming username only',async()=>{
 const f=fixture(),row=f.accounts.get(id);row.credential_vault=null;
 const change=changer(f);
 await assert.rejects(change(id,{...base,usernameMode:'manual',
  username:'AnotherUser',passwordMode:'keep'}),
  /xtream_gateway_password_not_recoverable/);
 assert.equal(f.accounts.get(id).username,'existing_client');
 assert.equal(f.events.length,0);
});

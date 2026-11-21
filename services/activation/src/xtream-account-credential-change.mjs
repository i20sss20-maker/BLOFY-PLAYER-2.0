/* Owner-only changes to the existing Xtream account's username and/or password.
 * Never create a second account, alter a voucher, reset subscription dates,
 * source, connection limit, or device binding. No plaintext in audit records.
 */
import crypto from 'node:crypto';
import {
  normalizeGatewayUsername,normalizeGatewayPassword,
  generateGatewayUsername,generateGatewayPassword,gatewayCredentialProof
} from './xtream-gateway-core.mjs';
import {encryptGatewayAccountPassword,decryptGatewayAccountPassword}
  from './xtream-account-vault.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MODES=new Set(['keep','manual','automatic']);
const fail=(code,status=409)=>Object.assign(new Error(code),{status});

export function createGatewayCredentialChanger({
 pool,keyHex,generateUsername=generateGatewayUsername,
 generatePassword=generateGatewayPassword,uuid=crypto.randomUUID
}={}){
 if(!pool||!/^[a-f0-9]{64}$/i.test(String(keyHex||'')))
   throw Error('xtream_gateway_change_not_configured');

 return async function changeExistingAccount(id,body={}){
  if(!UUID.test(String(id||'')))throw fail('xtream_gateway_account_invalid',400);
  const {usernameMode,passwordMode}=body||{};
  if(body?.acknowledgeDisconnect!==true)
    throw fail('xtream_gateway_change_requires_confirmation',400);
  if(!MODES.has(usernameMode)||!MODES.has(passwordMode)||
     (usernameMode==='keep'&&passwordMode==='keep'))
    throw fail('xtream_gateway_change_modes_invalid',400);
  if(typeof body.expectedUsername!=='string'||!body.expectedUsername||
     !Number.isSafeInteger(body.expectedUpdatedAt)||body.expectedUpdatedAt<=0)
    throw fail('xtream_gateway_change_expected_revision_invalid',400);
  let manualUsername=null,manualPassword=null;
  try{
   if(usernameMode==='manual')manualUsername=normalizeGatewayUsername(body.username);
   if(passwordMode==='manual')manualPassword=normalizeGatewayPassword(body.password);
  }catch(error){
   throw fail(error.message==='xtream_gateway_username_invalid'?
     'xtream_gateway_username_invalid':'xtream_gateway_password_invalid',400);
  }
  // Client must not silently send manual values when an alternate mode was selected.
  if((usernameMode!=='manual'&&body.username!==undefined&&body.username!=='')||
     (passwordMode!=='manual'&&body.password!==undefined&&body.password!==''))
    throw fail('xtream_gateway_change_unexpected_secret',400);

  for(let attempt=0;attempt<8;attempt++){
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    // This lock serializes changes to this exact account, rejecting stale tabs.
    const row=(await db.query(`SELECT id,username,credential_vault,updated_at
      FROM blofy_xtream_gateway_accounts WHERE id=$1 FOR UPDATE`,[id])).rows?.[0];
    if(!row)throw fail('xtream_gateway_account_not_found',404);
    if(String(row.username)!==body.expectedUsername||
       new Date(row.updated_at).getTime()!==body.expectedUpdatedAt)
      throw fail('xtream_gateway_change_account_modified',409);
    let username=row.username;
    if(usernameMode==='manual')username=manualUsername;
    if(usernameMode==='automatic'){
      username=generateUsername();
      if(username===row.username){username=generateUsername();}
      try{username=normalizeGatewayUsername(username)}
      catch{throw fail('xtream_gateway_change_generation_invalid',503)}
      if(username===row.username)throw fail('xtream_gateway_change_generation_invalid',503);
    }
    let password;
    if(passwordMode==='manual')password=manualPassword;
    else if(passwordMode==='automatic'){
      password=generatePassword();
      try{password=normalizeGatewayPassword(password)}
      catch{throw fail('xtream_gateway_change_generation_invalid',503)}
    }else{
      password=decryptGatewayAccountPassword(id,row.credential_vault,keyHex);
      if(!password)throw fail('xtream_gateway_password_not_recoverable',409);
    }
    if(username===row.username&&passwordMode==='keep')
      throw fail('xtream_gateway_change_nothing_changed',400);
    if(!password)throw fail('xtream_gateway_password_invalid',400);

    const proof=gatewayCredentialProof(username,password,keyHex);
    const vault=encryptGatewayAccountPassword(id,password,keyHex);
    // Unlike a separate PATCH + password reset, one UPDATE is atomic and
    // touches only the three authentication columns and its update timestamp.
    const updated=(await db.query(`UPDATE blofy_xtream_gateway_accounts
      SET username=$2,password_proof=$3,credential_vault=$4,updated_at=NOW()
      WHERE id=$1 RETURNING *`,[id,username,proof,vault])).rows?.[0];
    if(!updated)throw fail('xtream_gateway_account_not_found',404);

    // No secret, username, client address, or M3U URL enters the audit ledger.
    await db.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_credential_events(
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES blofy_xtream_gateway_accounts(id) ON DELETE CASCADE,
      username_mode TEXT NOT NULL,
      password_mode TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`INSERT INTO blofy_xtream_gateway_credential_events
      (id,account_id,username_mode,password_mode) VALUES($1,$2,$3,$4)`,[
       uuid(),id,usernameMode,passwordMode
    ]);
    await db.query('COMMIT');
    return {
      item:updated,username,password,usernameMode,passwordMode,
      accountId:id,subscriptionUnchanged:true,oldCredentialsDisabled:true
    };
   }catch(error){
    await db.query('ROLLBACK').catch(()=>{});
    if(error?.code==='23505'){
      // The only possible uniqueness collision is an account username.
      if(usernameMode==='automatic'&&attempt<7)continue;
      throw fail('xtream_gateway_username_exists',409);
    }
    throw error;
   }finally{db.release();}
  }
  throw fail('xtream_gateway_username_generation_failed',503);
 };
}

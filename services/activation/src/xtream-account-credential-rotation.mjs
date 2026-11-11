// Operator-initiated credential rotation for an EXISTING Xtream account.
// Never automatically rotate on "show credentials" or account export.
// Existing subscription code, activation date, account ID, source assignment,
// device binding, connection limit, expiry and subscriber records remain intact.
// Active Xtream connections using the old credentials disconnect immediately.
import {generateGatewayUsername,generateGatewayPassword,
  gatewayCredentialProof} from './xtream-gateway-core.mjs';
import {encryptGatewayAccountPassword} from './xtream-account-vault.mjs';

function fail(code,status=409) {
  return Object.assign(new Error(code),{status});
}

export function createGatewayCredentialRotator({
  pool,keyHex,generateUsername=generateGatewayUsername,
  generatePassword=generateGatewayPassword
}={}) {
  if(!pool||!/^[a-f0-9]{64}$/i.test(String(keyHex||'')))
    throw Error('xtream_gateway_rotation_not_configured');
  return async function rotateExistingAccount(id,{acknowledgeDisconnect=false}={}) {
    // An authenticated administrator must make an explicit, deliberate action;
    // never rotate by displaying/forwarding an existing M3U URL.
    if(acknowledgeDisconnect!==true)
      throw fail('xtream_gateway_rotation_requires_confirmation',400);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id||'')))
      throw fail('xtream_gateway_account_invalid',400);
    for(let attempt=0;attempt<8;attempt++) {
      const username=generateUsername();
      const password=generatePassword();
      // Keep only short alphanumeric values; legacy longer credentials are
      // VALID but never copied into newly rotated output.
      if(!/^[A-Za-z0-9]{8}$/.test(username)||!/^[A-Za-z0-9]{12}$/.test(password))
        throw fail('xtream_gateway_credential_generation_invalid',503);
      const proof=gatewayCredentialProof(username,password,keyHex);
      const vault=encryptGatewayAccountPassword(id,password,keyHex);
      try {
        const result=await pool.query(`UPDATE blofy_xtream_gateway_accounts
          SET username=$2,password_proof=$3,credential_vault=$4,
              updated_at=NOW()
          WHERE id=$1 RETURNING *`,[id,username,proof,vault]);
        const item=result.rows?.[0];
        if(!item)throw fail('xtream_gateway_account_not_found',404);
        // The statement updates NO account expiration, voucher, source,
        // device binding, connection limits or any subscriber entitlement.
        return {item,username,password,
          credentialRotation:true,subscriptionUnchanged:true,
          oldCredentialsDisabled:true};
      }catch(error) {
        if(error?.code==='23505')continue; // Usernames are unique: safely retry.
        throw error;
      }
    }
    throw fail('xtream_gateway_username_generation_failed',503);
  };
}

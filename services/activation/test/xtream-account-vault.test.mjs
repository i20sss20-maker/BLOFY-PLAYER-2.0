import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptGatewayAccountPassword,decryptGatewayAccountPassword}
  from '../src/xtream-account-vault.mjs';
const key='a'.repeat(64);
const id='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const other='d2bb0397-1c56-4751-adc9-1a17758022f6';
test('AES-GCM account vault restores one account password, not another',()=>{
 const secret='aBc987_def-TestPassword';
 const ciphertext=encryptGatewayAccountPassword(id,secret,key);
 assert.match(ciphertext,/^v1:[A-Za-z0-9_-]+$/);
 assert.equal(ciphertext.includes(secret),false);
 assert.equal(decryptGatewayAccountPassword(id,ciphertext,key),secret);
 assert.equal(decryptGatewayAccountPassword(other,ciphertext,key),null);
 assert.equal(decryptGatewayAccountPassword(id,ciphertext,'b'.repeat(64)),null);
 assert.notEqual(encryptGatewayAccountPassword(id,secret,key),ciphertext);
});
test('old accounts and tampered vault data never reveal a password',()=>{
 const encoded=encryptGatewayAccountPassword(id,'abcDE12_8',key);
 assert.equal(decryptGatewayAccountPassword(id,null,key),null);
 assert.equal(decryptGatewayAccountPassword(id,'bad',key),null);
 assert.equal(decryptGatewayAccountPassword(id,encoded.slice(0,-3)+'aaa',key),null);
 assert.throws(()=>encryptGatewayAccountPassword('not-an-id','abcDE12_8',key));
 assert.throws(()=>encryptGatewayAccountPassword(id,'short',key));
});

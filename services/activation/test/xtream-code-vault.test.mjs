import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptStreamCode,decryptStreamCode} from '../src/xtream-code-vault.mjs';
const key='ac'.repeat(32),id='550e8400-e29b-41d4-a716-446655440000';
const other='550e8400-e29b-41d4-a716-446655440001';
test('new codes are encrypted with unique nonce and bound to code ID',()=>{
  const first=encryptStreamCode(id,'12345678',key);
  const second=encryptStreamCode(id,'12345678',key);
  assert.notEqual(first,second);
  assert.equal(decryptStreamCode(id,first,key),'12345678');
  assert.equal(decryptStreamCode(other,first,key),null);
  assert.equal(decryptStreamCode(id,first,'ef'.repeat(32)),null);
  // Mutating the final character could change only unused base64url bits.
  // Change a guaranteed interior byte to validate the authenticated tag.
  const position=3+Math.floor((first.length-3)/2);
  const corrupted=first.slice(0,position)+(first[position]==='A'?'B':'A')+first.slice(position+1);
  assert.equal(decryptStreamCode(id,corrupted,key),null);
  assert.equal(decryptStreamCode(id,first+'=',key),null);
  assert.doesNotMatch(first,/12345678/);
});
test('historic nonexistent code vault is not recoverable and invalid IDs are rejected',()=>{
  assert.equal(decryptStreamCode(id,null,key),null);
  assert.throws(()=>encryptStreamCode('not-an-id','12345678',key),/invalid/);
});

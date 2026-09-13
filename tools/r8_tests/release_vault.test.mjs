import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal, unseal } from '../release_vault.mjs';
let dir, cert, key, other;
const payload = Buffer.from('private mapping and app bundle fixture');
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'blofy-vault-test-'));
  for (const name of ['recipient', 'other']) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=Disposable Vault Test', '-keyout', join(dir, name+'.key'), '-out', join(dir, name+'.pem')], {stdio:'ignore'});
  }
  cert = readFileSync(join(dir, 'recipient.pem')); key = readFileSync(join(dir, 'recipient.key'));
  other = readFileSync(join(dir, 'other.key'));
});
after(() => rmSync(dir, {recursive:true, force:true}));
const envelope = () => seal(payload, cert, 'a'.repeat(40));
test('owner key recovers exact bytes; archive has no plaintext payload or key', () => {
  const e = envelope(); assert.deepEqual(unseal(e, key), payload);
  assert.equal(JSON.stringify(e).includes(payload.toString()), false);
  assert.equal(JSON.stringify(e).includes('PRIVATE KEY'), false);
});
test('a different private key cannot decrypt', () => assert.throws(() => unseal(envelope(), other)));
test('ciphertext tampering is rejected', () => {
  const e=envelope(), bytes=Buffer.from(e.ciphertext,'base64'); bytes[0]^=1; e.ciphertext=bytes.toString('base64');
  assert.throws(() => unseal(e,key));
});
test('source commit tampering is rejected', () => { const e=envelope(); e.header.commit='b'.repeat(40); assert.throws(()=>unseal(e,key)); });
test('recipient metadata tampering is rejected', () => { const e=envelope(); e.header.certificate_sha256='b'.repeat(64); assert.throws(()=>unseal(e,key)); });
test('random IV and wrapped key differ for repeated encryption', () => {
  const a=envelope(), b=envelope(); assert.notEqual(a.iv,b.iv); assert.notEqual(a.wrapped_key,b.wrapped_key);
});
test('invalid source identity is rejected', () => assert.throws(()=>seal(payload,cert,'not-a-commit')));

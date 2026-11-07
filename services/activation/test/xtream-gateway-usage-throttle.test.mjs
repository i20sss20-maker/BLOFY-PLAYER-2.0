import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGatewayUsageThrottle} from '../src/xtream-gateway-usage-throttle.mjs';

test('repeated verified account requests require at most one usage write per minute',()=>{
  let now=200000;
  const gate=createGatewayUsageThrottle({clock:()=>now});
  assert.equal(gate.shouldWrite('account-a'),true);
  for(let i=0;i<1000;i++)assert.equal(gate.shouldWrite('account-a'),false);
  now+=59999;
  assert.equal(gate.shouldWrite('account-a'),false);
  now++;
  assert.equal(gate.shouldWrite('account-a'),true);
  assert.equal(gate.shouldWrite('account-b'),true);
});

test('a failed touch can retry; throttle memory is bounded',()=>{
  let now=0;
  const gate=createGatewayUsageThrottle({intervalMs:1000,maxEntries:2,clock:()=>now});
  assert.equal(gate.shouldWrite('one'),true);
  gate.forget('one');
  assert.equal(gate.shouldWrite('one'),true);
  assert.equal(gate.shouldWrite('two'),true);
  assert.equal(gate.shouldWrite('three'),true);
  assert.equal(gate.size,2);
  assert.equal(gate.shouldWrite('two'),false);
  assert.equal(gate.shouldWrite('one'),true);
  assert.equal(gate.size,2);
  now+=1000;
  assert.equal(gate.shouldWrite('one'),true);
  assert.equal(gate.size,2);
});

test('authentication remains database-backed and is not cached by throttle',async()=>{
  const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const from=source.indexOf('async function authenticate(');
  const end=source.indexOf('// A 290k-item catalog',from);
  const block=source.slice(from,end);
  assert.ok(from>=0&&end>from);
  assert.match(block,/await pool\.query\('SELECT \* FROM blofy_xtream_gateway_accounts WHERE username=\$1'/);
  assert.match(block,/verifyGatewayCredential\(row\.password_proof, username, password, KEY_HEX\)/);
  assert.match(block,/accountUsageThrottle\.shouldWrite\(row\.id\)/);
  assert.match(block,/accountUsageThrottle\.forget\(row\.id\)/);
  assert.doesNotMatch(block,/if\s*\(cachedAccount\)/);
  assert.throws(()=>createGatewayUsageThrottle({intervalMs:0}),/invalid/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../web/',import.meta.url);
const gateway=await readFile(new URL('xtream-gateway-admin.js',base),'utf8');
const premium=await readFile(new URL('stream-premium.js',base),'utf8');
const page=await readFile(new URL('sources-admin.html',base),'utf8');
const css=await readFile(new URL('stream-premium.css',base),'utf8');

function isolateFunction(name) {
  const match=gateway.match(new RegExp('function '+name+'\\([^)]*(?:\\([^)]*\\)[^)]*)?\\)\\{[\\s\\S]*?\\n\\}'));
  assert.ok(match,'Missing gateway helper: '+name);
  return match[0];
}

const parseExpiry=Function(isolateFunction('accountExpiryMs')+'; return accountExpiryMs;')();
const flags=Function(isolateFunction('accountExpiryMs')+'\n'+isolateFunction('gatewayAccountFlags')+'; return gatewayAccountFlags;')();

test('epoch-milliseconds, seconds and ISO expiration dates are supported',()=>{
  const expiry=Date.parse('2026-11-10T00:00:00Z');
  assert.equal(parseExpiry(expiry),expiry);
  assert.equal(parseExpiry(expiry/1000),expiry);
  assert.equal(parseExpiry('2026-11-10T00:00:00.000Z'),expiry);
  assert.equal(parseExpiry(null),null);
  assert.equal(parseExpiry(''),null);
  assert.equal(parseExpiry('bad date'),null);
});

test('expiring or expired account status is consistent',()=>{
  const now=Date.parse('2026-11-07T00:00:00Z');
  assert.equal(flags({enabled:true,expiresAt:new Date(now+3*86400000).toISOString()},now).expiring,true);
  assert.equal(flags({enabled:true,expiresAt:now-1000},now).expired,true);
  assert.equal(flags({enabled:true,expiresAt:null},now).expired,false);
  assert.equal(flags({enabled:false,expiresAt:null},now).disabled,true);
});

test('unlimited accounts are protected from accidental 30-day renewal',()=>{
  assert.match(gateway,/renew\.disabled=accountExpiryMs\(item\.expiresAt\)===null/);
  assert.match(gateway,/const existingExpiry=accountExpiryMs\(item\.expiresAt\)/);
  assert.match(gateway,/const starting=Math\.max\(now,existingExpiry\)/);
});

test('operator alerts and auto-refresh use existing admin read endpoints only',()=>{
  for(const id of ['streamAutoRefreshToggle','premiumActionableIssues','premiumReviewExpiring','premiumReviewSources','premiumAccountsDisabled'])
    assert.ok(page.includes('id="'+id+'"'),id);
  assert.match(premium,/function setAutoRefresh\(/);
  assert.match(premium,/90000/);
  assert.match(premium,/document\.visibilityState/);
  assert.match(premium,/blofy:refresh-accounts/);
  assert.match(gateway,/document\.addEventListener\('blofy:refresh-accounts'/);
  assert.match(css,/\.premium-actionable-issues/);
});

test('subscriber summary emits counts without exposing private account fields',()=>{
  const record=gateway.split('const accountSnapshot=')[1]?.split('window.__BLOFY_ACCOUNT_SUMMARY__')[0]??'';
  assert.ok(record.length>0);
  for(const prop of ['username','password','credentials','token','secret','host','email','phone'])
    assert.ok(!record.includes(prop),'Found sensitive property '+prop);
  for(const count of ['total','active','expiring','expired','disabled'])
    assert.ok(record.includes(count+':'),'Summary missing '+count);
});

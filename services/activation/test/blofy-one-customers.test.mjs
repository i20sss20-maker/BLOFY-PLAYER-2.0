import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';

const from = name => readFile(new URL('../web/'+name, import.meta.url),'utf8');
test('BLOFY ONE customer directory uses real signed-session device records and code summary', async()=>{
  const [html,js,css]=await Promise.all([
    from('blofy-one.html'),from('blofy-one-customers.js'),from('blofy-one-customers.css')
  ]);
  assert.doesNotThrow(()=>new Script(js));
  for(const asset of ['/blofy-one-customers.js?v=20261118-v1','/blofy-one-customers.css?v=20261118-v1'])
    assert.ok(html.includes(asset));
  for(const id of [
    'one-customer-metrics','one-customer-rows','one-customer-search-form','one-customer-dialog',
    'one-customer-edit-form','one-customer-save','one-customer-toggle-block',
    'one-customer-status','one-customer-page','one-customer-export'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(js,/\/api\/v1\/admin\/device-insights/);
  assert.match(js,/\/api\/v1\/admin\/code-ops\/summary/);
  assert.match(css,/\.one-customer-table-wrap/);
  assert.match(css,/@media\(max-width:640px\)/);
});
test('BLOFY ONE customer writes require explicit confirmations and expected existing state',async()=>{
  const js=await from('blofy-one-customers.js');
  const [html,handler]=await Promise.all([
    from('blofy-one.html'),readFile(new URL('../src/admin-console-hook.mjs',import.meta.url),'utf8')
  ]);
  assert.match(js,/method, credentials: 'same-origin', cache: 'no-store'/);
  assert.match(js,/body.expectedRevision = record.revision/);
  assert.match(js,/expectedStatus: record.status/);
  assert.match(js,/expectedExpiresAt: record.expiresAt/);
  assert.match(js,/window.confirm/);
  assert.match(js,/action: isBlocked \? 'unblock' : 'block'/);
  assert.match(js,/replaceAll\('"', '""'\)/);
  assert.match(js,/\^\[\\s\]\*\[=\+\\-@\]/); // CSV formula protection
  assert.doesNotMatch(js,/localStorage|sessionStorage|console\.log|eval\(/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)[^>]*>/);
  for(const asset of ['/blofy-one-customers.js','/blofy-one-customers.css'])
    assert.ok(handler.includes("['"+asset+"'"),asset);
  assert.match(handler,/x-content-type-options': 'nosniff'/);
});

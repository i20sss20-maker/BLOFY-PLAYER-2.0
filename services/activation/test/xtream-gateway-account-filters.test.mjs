import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('BLOFY Xtream issued accounts can be searched and filtered without backend changes',async()=>{
  const [html,js,css]=await Promise.all([
    read('web/sources-admin.html'),read('web/xtream-gateway-admin.js'),read('web/sources-admin.css')
  ]);
  for(const id of ['gatewayAccountSearch','gatewayAccountFilter','gatewayAccountsSummary'])
    assert.match(html,new RegExp('id="'+id+'"'));
  for(const v of ['enabled','expired','expiring','disabled'])
    assert.match(html,new RegExp('value="'+v+'"'));
  assert.match(js,/gx\('gatewayAccountSearch'\)\?\.addEventListener\('input',renderGatewayAccounts\)/);
  assert.match(js,/gx\('gatewayAccountFilter'\)\?\.addEventListener\('change',renderGatewayAccounts\)/);
  assert.match(js,/function gatewayAccountFlags\(item,now=Date\.now\(\)\)/);
  assert.match(js,/expires-now<=7\*86400000/);
  assert.match(js,/if\(filter==='expired'\)return flags\.expired/);
  assert.match(js,/if\(filter==='expiring'\)return flags\.expiring/);
  assert.match(js,/if\(filter==='disabled'\)return flags\.disabled/);
  assert.match(js,/if\(query&&!text\.includes\(query\)\)return false/);
  assert.match(css,/\.gateway-accounts-toolbar/);
});

test('customer account renewal remains an explicit administrator action, passwords unchanged',async()=>{
  const js=await read('web/xtream-gateway-admin.js');
  const render=js.slice(js.indexOf('function renderGatewayAccounts()'),js.indexOf('async function loadGateway()'));
  assert.match(render,/const renew=gatewayNode\('button', 'button ghost', accountExpiryMs\(item\.expiresAt\)===null\?'بدون انتهاء':'تجديد شهر'\)/);
  assert.match(render,/renew\.disabled=accountExpiryMs\(item\.expiresAt\)===null/);
  assert.match(render,/window\.confirm\('تجديد اشتراك '/);
  assert.match(render,/method:'PATCH',body:JSON\.stringify\(\{expiresAt:/);
  assert.match(render,/actions\\.append\\(copy, renew, toggle, reset, rotate, remove\\)/);
  assert.match(render,/rotate\\.addEventListener\\('click'/);
  assert.match(render,/acknowledgeDisconnect:true/);
  assert.match(render,/rotate-credentials/);
  // Rotating an old M3U login is not the same as renewing a subscription.
  assert.match(render,/window\\.prompt\\('لتأكيد قطع اتصال بيانات الدخول القديمة/);
  assert.doesNotMatch(render,/\bdeleteAccountAutomatically\(/);
});

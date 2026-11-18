import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('code lifecycle modal is part of BLOFY ONE, not a separate admin website',async()=>{
  const [html,stream,manager,css,hook]=await Promise.all([
    read('web/blofy-one.html'),read('web/blofy-one-stream.js'),
    read('web/blofy-one-code-manager.js'),read('web/blofy-one-code-manager.css'),
    read('src/admin-console-hook.mjs')
  ]);
  assert.doesNotThrow(()=>new Script(manager));
  assert.doesNotThrow(()=>new Script(stream));
  for(const id of [
    'one-code-manager','one-code-manager-close','one-code-manager-title',
    'one-code-manager-status','one-code-manager-hint','one-code-manager-state',
    'one-code-manager-expiry','one-code-manager-sold','one-code-manager-channel',
    'one-code-sell-form','one-code-extend-form','one-code-relogin-submit',
    'one-code-revoke-submit','one-code-revoke-confirm',
    'one-code-panel-sell','one-code-panel-extend','one-code-panel-relogin',
    'one-code-panel-revoke','one-code-buyer-name','one-code-buyer-phone',
    'one-code-sell-price','one-code-sell-channel','one-code-extend-days'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  assert.equal((html.match(/id="one-code-manager"/g)||[]).length,1);
  assert.match(stream,/new CustomEvent\('blofy-one:manage-code'/);
  assert.match(manager,/addEventListener\('blofy-one:manage-code'/);
  assert.match(stream,/إدارة الاشتراك/);
  assert.match(css,/\.one-code-manager::backdrop/);
  assert.match(css,/@media\(max-width:640px\)/);
  for(const asset of ['/blofy-one-code-manager.js','/blofy-one-code-manager.css']){
    assert.ok(hook.includes("['"+asset+"'"),asset);
    assert.ok(html.includes(asset+'?v=20261118-v1'),asset);
  }
});
test('sales are explicitly manual recorded revenue, not fabricated bank payments',async()=>{
  const [html,js]=await Promise.all([read('web/blofy-one.html'),
    read('web/blofy-one-code-manager.js')]);
  assert.match(html,/لا تُحصّل مبلغًا ولا تتحقق من Geidea/);
  assert.match(js,/priceSar:price,channel/);
  assert.match(js,/Math\.round\(price\*100\)/);
  assert.match(js,/\['manual','whatsapp','store_manual'\]/);
  assert.match(js,/data\.ok!==true/);
  assert.doesNotMatch(js,/\/api\/v1\/payments|\/api\/v1\/subscriptions\/checkout|\/api\/v1\/stream\/redeem/);
});
test('all code mutations require owner confirmation, fresh readback and guarded conditions',async()=>{
  const js=await read('web/blofy-one-code-manager.js');
  assert.match(js,/await readCurrent\(previous\.id\)/);
  assert.match(js,/if\(!sameState\(previous,fresh\)\)/);
  assert.match(js,/if\(!can\(action,fresh\)\)/);
  assert.match(js,/window\.confirm\(confirmation\(fresh\)\)/);
  assert.match(js,/sent=true/);
  assert.match(js,/await readCurrent\(fresh\.id\)/);
  assert.match(js,/result\.item\?\.id!==fresh\.id/);
  assert.match(js,/if\(busy\|\|!selected\|\|!can\(action,selected\)\)return/);
  assert.match(js,/action==='revoke'\)return c\.status==='unused'/);
  assert.match(js,/action==='extend'\)return c\.status==='redeemed'&&Boolean\(c\.accountId\)/);
  assert.match(js,/action==='sell'\)return c\.soldAt===null\|\|c\.soldAt===undefined/);
  assert.match(js,/action==='relogin'\)return c\.status==='redeemed'/);
  assert.match(js,/c\.deviceTransferPending===false/);
  assert.match(js,/adminReloginUntil\)>Date\.now\(\)/);
  assert.match(js,/value\.trim\(\)!=='إلغاء'/);
  assert.match(js,/لا تُعد إرسال العملية قبل فحص السجل/);
  assert.doesNotMatch(js,/setInterval|autoRenew|localStorage|sessionStorage|innerHTML\s*=|console\.log/);
});
test('bulk issuance uses native backend max 20, but requires a second confirmation beyond 5',async()=>{
  const [html,operations,codes]=await Promise.all([
    read('web/blofy-one.html'),read('web/blofy-one-operations.js'),
    read('src/xtream-duration-codes.mjs')
  ]);
  assert.match(html,/id="one-issue-quantity" type="number" min="1" max="20"/);
  assert.match(operations,/payload\.quantity<1\|\|payload\.quantity>20/);
  assert.match(operations,/if\(payload\.quantity>5&&!window\.confirm/);
  assert.match(operations,/window\.confirm\('إصدار '/);
  assert.match(codes,/quantity>20/);
  assert.match(operations,/window\.setTimeout\(hideIssued,90000\)/);
  assert.doesNotMatch(operations,/\/api\/v1\/stream\/redeem/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const asset=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');
test('owner console exposes ONE repeated-extraction action inside the unified code register',()=>{
  const html=asset('blofy-one.html');
  const panel=asset('blofy-one-code-center.js');
  const register=asset('blofy-one-code-register.js');
  const css=asset('blofy-one-code-register.css');
  assert.match(html,/blofy-one-unified-extract\.js\?v=/);
  assert.match(panel,/one-register-extract/);
  assert.match(panel,/one-register-bundle-code/);
  assert.match(panel,/one-register-xtream-host/);
  assert.match(panel,/one-register-xtream-password/);
  assert.match(panel,/one-register-m3u-copy/);
  assert.match(panel,/one-register-xtream-hide/);
  assert.match(panel,/قائمة الأكواد وXtream/);
  assert.match(register,/blofy-one:register-open/);
  assert.match(register,/voucherId:item\.voucherId/);
  assert.match(css,/one-register-xtream-secret\[hidden\]/);
  assert.doesNotThrow(()=>new Script(asset('blofy-one-unified-extract.js')));
  assert.doesNotThrow(()=>new Script(panel));
});
test('re-extraction is exact-voucher read only and uses admin-only POST endpoints',()=>{
  const source=asset('blofy-one-unified-extract.js');
  assert.match(source,/\/api\/v1\/admin\/store\/codes\/reveal/);
  assert.match(source,/\/api\/v1\/admin\/xtream-gateway\/link\/code-to-xtream/);
  assert.match(source,/linked\.codeId!==id/);
  assert.match(source,/linked\.subscriptionUnchanged!==true/);
  assert.match(source,/linked\.created!==false/);
  assert.match(source,/method:'POST'/);
  assert.match(source,/credentials:'same-origin'/);
  assert.match(source,/cache:'no-store'/);
  assert.match(source,/window\.confirm/);
  assert.match(source,/pagehide/);
  assert.match(source,/visibilitychange/);
  assert.match(source,/clearTimeout\(timer\)/);
  assert.match(source,/30000/);
  assert.match(source,/voucherId:id,purpose:'customer_support'/);
  for(const forbidden of ['localStorage','sessionStorage','console.log',
    '/api/v1/admin/xtream-gateway/link/xtream-to-code','/api/v1/admin/xtream-gateway/accounts/',
    '/api/v1/admin/xtream-gateway/codes/redeem','/api/v1/admin/xtream-gateway/codes/extend',
    '/api/v1/admin/store/cart/checkout'])
    assert.ok(!source.includes(forbidden),'unsafe route or persistence: '+forbidden);
});

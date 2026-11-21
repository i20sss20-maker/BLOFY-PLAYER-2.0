import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Domain association file is supplied by Geidea for the merchant, not generated
// or modified by BLOFY. This offline gate confirms that the provider's exact
// bytes are committed and served without login/HTML/redirect by the portal.
test('real Geidea association is available on the canonical BLOFY domain without edits',()=>{
 const file=readFileSync(new URL('../web/.well-known/apple-developer-merchantid-domain-association',import.meta.url));
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(file.length>4000,'must not substitute a placeholder merchant association file');
 assert.ok(/^[A-Za-z0-9+\/=\r\n]+$/.test(file.toString('utf8').trim()),
  'merchant association must preserve original signed/text bytes');
 assert.match(server,/\['GET','HEAD'\]\.includes\(req\.method \|\| ''\)/);
 assert.match(server,/requestUrl\.pathname === '\/\.well-known\/apple-developer-merchantid-domain-association'/);
 assert.match(server,/readFile\(new URL\('\.\.\/web\/\.well-known\/apple-developer-merchantid-domain-association'/);
 assert.match(server,/'content-type': 'text\/plain; charset=utf-8'/);
 assert.match(server,/return res\.end\(req\.method === 'HEAD' \? undefined : file\)/);
});
test('Apple Pay acceptance requires a server-verified Geidea capture, never the browser return',()=>{
 const js=readFileSync(new URL('../web/store-cart.js',import.meta.url),'utf8');
 const core=readFileSync(new URL('../src/geidea-live.mjs',import.meta.url),'utf8');
 assert.match(js,/await request\('\/api\/v1\/store\/orders\/status'/);
 assert.match(core,/totalCapturedAmount/);
 assert.match(core,/totalRefundedAmount/);
 assert.match(core,/approvedPaymentMethod/);
 assert.match(core,/applePayEnabled===true/);
 assert.match(core,/normalizeWallet\(method\.wallet\)==='applepay'/);
 assert.doesNotMatch(js,/ApplePaySession\.begin\(/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

const html=readFileSync(new URL('../web/store.html',import.meta.url),'utf8');
test('Arabic store has one verified WhatsApp destination and preserves customer portal',()=>{
 assert.match(html,/<html lang="ar" dir="rtl">/);
 assert.match(html,/https:\/\/wa\.me\/966568941484/);
 assert.match(html,/href="\/portal"/);
 assert.match(html,/href="\/downloads"/);
 assert.match(html,/href="\/privacy"/);
 assert.match(html,/href="\/support"/);
 assert.match(html,/href="\/pay"/);
 assert.doesNotMatch(html,/GEIDEA_LIVE_API_PASSWORD|GEIDEA_LIVE_MERCHANT_PUBLIC_KEY|<input[^>]+(?:card|cvv)/i);
});
test('Store payment plans only derive from verified activated Geidea plans',()=>{
 assert.match(html,/\/api\/v1\/subscriptions\/plans/);
 assert.match(html,/data\.provider!=='geidea'/);
 assert.match(html,/data\.purchasesAvailable!==true/);
 assert.match(html,/Number\.isInteger\(p\.priceMinor\)/);
 assert.match(html,/textContent=p\.name/);
 assert.match(html,/location\.replace\('\/portal'\+hash\)/);
});
test('Page JavaScript parses without touching network or external services',()=>{
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,2);
 for(const s of scripts)assert.doesNotThrow(()=>new Function(s[1]));
});
test('Subscriber portal HTML injection does not target new public store',()=>{
 assert.equal(injectSubscriberPortalUi(html),html);
 const original='<!doctype html><html><body><div id="loginView"></div></body></html>';
 assert.notEqual(injectSubscriberPortalUi(original),original);
});

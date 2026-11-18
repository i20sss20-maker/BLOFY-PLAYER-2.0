import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

const html=readFileSync(new URL('../web/store.html',import.meta.url),'utf8');
test('BLOFY storefront sells STREAM code and Xtream subscriptions only',()=>{
 assert.match(html,/<html lang="ar" dir="rtl">/);
 assert.match(html, /اشتراك كود BLOFY STREAM/);
 assert.match(html, /اشتراك Xtream BLOFY/);
 assert.equal((html.match(/<article class="product"/g)||[]).length,2);
 assert.match(html, /data-wa="stream"/);
 assert.match(html, /data-wa="xtream"/);
 assert.match(html, /https:\/\/wa\.me\/966568941484/);
 assert.match(html, /value="3 أشهر"/);
 assert.match(html, /value="6 أشهر"/);
 assert.match(html, /value="سنة"/);
 assert.doesNotMatch(html, /\/downloads|تحميل التطبيق|ملف APK|BLOFY BUSINESS|href="\/pay"/);
});
test('Product checkout is inquiry-first; no misleading device-payment link or unverified prices',()=>{
 assert.match(html,/السعر/);
 assert.match(html,/تأكيد السعر/);
 assert.match(html,/Geidea/);
 assert.match(html,/ولا يُصدر كود BLOFY STREAM أو بيانات Xtream تلقائيًا/);
 assert.match(html,/encodeURIComponent\(message\+source\)/);
 assert.match(html,/value=dropdown&&dropdown\.value/);
 assert.match(html,/href="\/privacy"/);
 assert.match(html,/href="\/support"/);
 assert.match(html,/location\.replace\('\/portal'\+hash\)/);
 assert.doesNotMatch(html,/GEIDEA_LIVE_API_PASSWORD|GEIDEA_LIVE_MERCHANT_PUBLIC_KEY|<input[^>]+(?:card|cvv)/i);
});
test('Store JavaScript parses without touching external providers',()=>{
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,2);
 for(const s of scripts)assert.doesNotThrow(()=>new Function(s[1]));
});
test('Subscriber portal HTML injection does not target subscription store',()=>{
 assert.equal(injectSubscriberPortalUi(html),html);
 const original='<!doctype html><html><body><div id="loginView"></div></body></html>';
 assert.notEqual(injectSubscriberPortalUi(original),original);
});
